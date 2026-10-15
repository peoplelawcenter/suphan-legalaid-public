import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { archiveStream, restoreSnapshot, verifySnapshot, writeManifest } from './backup/archive.mjs';
import { createBackup, dumpDatabase, storageClient } from './backup/create.mjs';

const root = await mkdtemp(join(tmpdir(), 'encrypted-backup-test-'));
const key = randomBytes(32);
const bytes = Buffer.alloc(17 * 1024 * 1024, 0x51);
const files = new Map([
  ['private/คนไทย/document.pdf', Buffer.from('private synthetic record')],
  ['private/empty.bin', Buffer.alloc(0)],
  ['public/photo.bin', bytes],
]);
for (let i = 0; i < 101; i++) files.set(`private/many/${i.toString().padStart(3, '0')}.txt`, Buffer.from(`synthetic-${i}`));
const storage = {
  async listBuckets(offset) { return [{ name: 'private' }, { name: 'public' }].slice(offset, offset + 100); },
  async listObjects(bucket, prefix, offset) {
    const children = new Map();
    for (const path of files.keys()) {
      if (!path.startsWith(`${bucket}/${prefix}`)) continue;
      const suffix = path.slice(bucket.length + 1 + prefix.length);
      const [name, rest] = suffix.split(/\/(.*)/s);
      children.set(name, rest === undefined ? { name, id: path, metadata: { mimetype: 'application/octet-stream' } } : { name, id: null });
    }
    return [...children.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + 100);
  },
  async download(bucket, path) {
    const body = files.get(`${bucket}/${path}`);
    assert.ok(body);
    return { body: Readable.from([body]), headers: { get: () => 'application/octet-stream' } };
  },
};

try {
  const database = () => archiveStream(root, key, Readable.from([Buffer.from('PGDMP synthetic')]));
  const first = await createBackup(root, key, { database, storage });
  const chunkCount = (await readdir(join(root, 'chunks'))).length;
  const second = await createBackup(root, key, { database, storage });
  assert.equal((await readdir(join(root, 'chunks'))).length, chunkCount, 'unchanged bytes deduplicate');
  const manifest = await verifySnapshot(root, key, second);
  assert.equal(manifest.objects.length, files.size);
  assert.equal(manifest.objects.find(item => item.path === 'photo.bin').chunks.length, 2);
  const destination = join(root, 'restored');
  await restoreSnapshot(root, key, first, destination);
  assert.equal((await readFile(join(destination, 'database.dump'))).toString(), 'PGDMP synthetic');
  for (const [path, body] of files) assert.deepEqual(await readFile(join(destination, 'storage', ...path.split('/'))), body);
  await assert.rejects(() => restoreSnapshot(root, key, first, destination), /exist/);
  await assert.rejects(() => verifySnapshot(root, randomBytes(32), first));
  const manifestFile = join(root, 'snapshots', first);
  const originalManifest = await readFile(manifestFile);
  await writeFile(manifestFile, originalManifest.subarray(0, originalManifest.length - 1));
  await assert.rejects(() => verifySnapshot(root, key, first));
  await writeFile(manifestFile, originalManifest);
  await assert.rejects(() => writeManifest(root, key, { ...manifest, objects: [{ ...manifest.objects[0], path: '../escape' }] }), /Invalid storage path/);
  await assert.rejects(() => writeManifest(root, key, { ...manifest, database: { chunks: [] } }), /Empty database dump/);
  await assert.rejects(() => writeManifest(root, key, { ...manifest, objects: [
    { bucket: 'private', path: 'parent', contentType: 'text/plain', chunks: [] },
    { bucket: 'private', path: 'parent/child', contentType: 'text/plain', chunks: [] },
  ] }), /collision/);
  await assert.rejects(() => writeManifest(root, key, { ...manifest, objects: [
    { bucket: 'private', path: 'Foo', contentType: 'text/plain', chunks: [] },
    { bucket: 'private', path: 'foo', contentType: 'text/plain', chunks: [] },
  ] }), /Duplicate storage path/);
  const ioFailure = await writeManifest(root, key, { ...manifest, objects: [
    { bucket: 'private', path: 'a'.repeat(300), contentType: 'text/plain', chunks: [] },
  ] });
  const ioDestination = join(root, 'io-failure');
  await assert.rejects(() => restoreSnapshot(root, key, ioFailure, ioDestination));
  await assert.rejects(() => stat(ioDestination), { code: 'ENOENT' });
  await assert.rejects(() => dumpDatabase(root, key, 'postgresql://user:password@localhost/test', '__no_pg_dump_executable__'), /Database dump failed/);
  const id = manifest.database.chunks[0];
  const file = join(root, 'chunks', `${id}.enc`);
  const saved = await readFile(file);
  await writeFile(file, saved.subarray(0, saved.length - 1));
  await assert.rejects(() => verifySnapshot(root, key, second));
  await writeFile(file, saved);
  await rename(file, `${file}.missing`);
  await assert.rejects(() => verifySnapshot(root, key, second), /ENOENT/);
  await rename(`${file}.missing`, file);
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ path: new URL(url).pathname, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
    if (requests.length === 1) return new Response(JSON.stringify([{ name: 'private' }]), { status: 200 });
    if (requests.length === 2) return new Response(JSON.stringify([{ name: 'file.txt', id: '1' }]), { status: 200 });
    return new Response('synthetic download', { status: 200 });
  };
  try {
    const client = storageClient('https://example.test', 'synthetic-key');
    assert.equal((await client.listBuckets(0)).length, 1);
    assert.equal((await client.listObjects('private', 'folder/', 0)).length, 1);
    assert.equal(await (await client.download('private', 'folder/file.txt')).text(), 'synthetic download');
    assert.deepEqual(requests.map(item => item.path), ['/storage/v1/bucket', '/storage/v1/object/list/private', '/storage/v1/object/private/folder/file.txt']);
    assert.equal(requests[1].body.prefix, 'folder/');
  } finally { globalThis.fetch = originalFetch; }
  assert.ok((await stat(file)).size < 32 * 1024 * 1024);
  process.stdout.write('Encrypted backup synthetic round-trip, pagination, deduplication, and failure checks passed.\n');
} finally {
  await rm(root, { recursive: true, force: true });
}
