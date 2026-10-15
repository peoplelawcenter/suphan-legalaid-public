import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const CHUNK_SIZE = 16 * 1024 * 1024;
const MAGIC = Buffer.from('SBK1');
const ID_PATTERN = /^[0-9a-f]{64}$/;

export function keyFromEnvironment(value) {
  if (!/^[0-9a-fA-F]{64}$/.test(value ?? '')) throw new Error('BACKUP_KEY_HEX must be 64 hexadecimal characters');
  return Buffer.from(value, 'hex');
}

function idFor(key, plain) {
  return createHmac('sha256', key).update('chunk-v1\0').update(plain).digest('hex');
}

function seal(key, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function unseal(key, data) {
  if (data.length < 32 || !data.subarray(0, 4).equals(MAGIC)) throw new Error('Invalid encrypted file');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(4, 16));
  decipher.setAuthTag(data.subarray(16, 32));
  return Buffer.concat([decipher.update(data.subarray(32)), decipher.final()]);
}

async function* fixedChunks(stream) {
  let pending = Buffer.allocUnsafe(CHUNK_SIZE);
  let used = 0;
  for await (const part of stream) {
    let input = Buffer.from(part);
    while (input.length) {
      const take = Math.min(CHUNK_SIZE - used, input.length);
      input.copy(pending, used, 0, take);
      used += take;
      input = input.subarray(take);
      if (used === CHUNK_SIZE) { yield pending; pending = Buffer.allocUnsafe(CHUNK_SIZE); used = 0; }
    }
  }
  if (used) yield pending.subarray(0, used);
}

async function verifiedChunk(root, key, id) {
  if (!ID_PATTERN.test(id)) throw new Error('Invalid chunk reference');
  const data = await readFile(join(root, 'chunks', `${id}.enc`));
  const plain = unseal(key, data);
  if (plain.length > CHUNK_SIZE || idFor(key, plain) !== id) throw new Error('Chunk integrity check failed');
  return plain;
}

export async function archiveStream(root, key, stream) {
  await mkdir(join(root, 'chunks'), { recursive: true });
  const ids = [];
  for await (const plain of fixedChunks(stream)) {
    const id = idFor(key, plain);
    const file = join(root, 'chunks', `${id}.enc`);
    try {
      const existing = await verifiedChunk(root, key, id);
      if (!existing.equals(plain)) throw new Error('Chunk collision');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const handle = await open(file, 'wx');
      try { await handle.writeFile(seal(key, plain)); } finally { await handle.close(); }
    }
    ids.push(id);
  }
  return ids;
}

export async function writeManifest(root, key, manifest) {
  validateManifest(manifest);
  await mkdir(join(root, 'snapshots'), { recursive: true });
  const name = `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(4).toString('hex')}.enc`;
  const handle = await open(join(root, 'snapshots', name), 'wx');
  try { await handle.writeFile(seal(key, Buffer.from(JSON.stringify(manifest)))); } finally { await handle.close(); }
  return name;
}

export async function readManifest(root, key, name) {
  if (!/^\d{4}-\d\d-\d\dT[0-9T.Z-]+-[0-9a-f]{8}\.enc$/.test(name)) throw new Error('Invalid snapshot name');
  const manifest = JSON.parse(unseal(key, await readFile(join(root, 'snapshots', name))).toString('utf8'));
  validateManifest(manifest);
  return manifest;
}

function safeSegment(value) {
  return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..'
    && !/[\\/:<>?*|"\x00-\x1f]/.test(value) && !/[. ]$/.test(value)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}

function safeObjectPath(value) {
  return typeof value === 'string' && value.split('/').every(safeSegment);
}

function validateIds(ids) {
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && ID_PATTERN.test(id))) throw new Error('Invalid chunk references');
}

function validateManifest(m) {
  if (m?.version !== 1 || !Array.isArray(m.objects) || !m.database || typeof m.createdAt !== 'string') throw new Error('Invalid manifest');
  validateIds(m.database.chunks);
  if (!m.database.chunks.length) throw new Error('Empty database dump');
  const seen = new Set();
  const seenCasefold = new Set();
  for (const object of m.objects) {
    if (!safeSegment(object.bucket) || !safeObjectPath(object.path) || typeof object.contentType !== 'string') throw new Error('Invalid storage path');
    validateIds(object.chunks);
    const path = `${object.bucket}/${object.path}`;
    if (seen.has(path) || seenCasefold.has(path.toLowerCase())) throw new Error('Duplicate storage path');
    seen.add(path);
    seenCasefold.add(path.toLowerCase());
  }
  for (const path of seen) {
    const segments = path.split('/');
    for (let count = 2; count < segments.length; count++) {
      if (seenCasefold.has(segments.slice(0, count).join('/').toLowerCase())) throw new Error('Storage file/folder collision');
    }
  }
}

export async function verifySnapshot(root, key, name) {
  const manifest = await readManifest(root, key, name);
  const ids = new Set([...manifest.database.chunks, ...manifest.objects.flatMap(item => item.chunks)]);
  for (const id of ids) await verifiedChunk(root, key, id);
  return manifest;
}

async function writeParts(root, key, ids, target) {
  await mkdir(dirname(target), { recursive: true });
  async function* plaintext() {
    for (const id of ids) yield await verifiedChunk(root, key, id);
  }
  await pipeline(Readable.from(plaintext()), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
}

export async function restoreSnapshot(root, key, name, destination) {
  const manifest = await verifySnapshot(root, key, name);
  const target = resolve(destination);
  await mkdir(target); // Refuse an existing destination, including a symlink.
  try {
    await writeParts(root, key, manifest.database.chunks, join(target, 'database.dump'));
    for (const item of manifest.objects) {
      const file = resolve(target, 'storage', item.bucket, ...item.path.split('/'));
      if (!file.startsWith(`${target}${sep}`)) throw new Error('Invalid destination');
      await writeParts(root, key, item.chunks, file);
    }
    await writeFile(join(target, 'storage-metadata.json'), JSON.stringify(manifest.objects.map(({ bucket, path, contentType }) => ({ bucket, path, contentType })), null, 2), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

export async function latestSnapshot(root) {
  const names = (await readdir(join(root, 'snapshots'))).filter(name => name.endsWith('.enc')).sort();
  if (!names.length) throw new Error('No snapshots found');
  return names.at(-1);
}
