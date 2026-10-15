import { spawn } from 'node:child_process';
import { archiveStream, writeManifest } from './archive.mjs';

function postgresEnvironment(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch { throw new Error('Invalid BACKUP_DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1)) throw new Error('Invalid BACKUP_DATABASE_URL');
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get('sslmode') || 'require',
  };
}

export async function dumpDatabase(root, key, connectionString, command = process.env.BACKUP_PG_DUMP || 'pg_dump') {
  const env = postgresEnvironment(connectionString);
  const docker = command === 'docker';
  const args = docker
    ? ['run', '--rm', '-i', '--network=host', ...Object.keys(env).flatMap(name => ['-e', name]), 'postgres:17.6', 'pg_dump', '--format=custom', '--no-owner']
    : ['--format=custom', '--no-owner'];
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = new Promise(resolve => {
    child.once('error', () => resolve(false));
    child.once('close', code => resolve(code === 0));
  });
  try {
    const chunks = await archiveStream(root, key, child.stdout);
    if (!(await exited)) throw new Error('Database dump failed');
    if (!chunks.length) throw new Error('Database dump was empty');
    return chunks;
  } catch (error) {
    child.kill();
    await exited;
    throw error;
  }
}

export function storageClient(url, serviceKey) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || !serviceKey) throw new Error('Invalid Supabase backup configuration');
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  async function json(path, body) {
    const response = await fetch(new URL(path, endpoint), {
      method: body ? 'POST' : 'GET', headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('Storage listing failed');
    return response.json();
  }
  return {
    async listBuckets(offset) {
      return json(`/storage/v1/bucket?limit=100&offset=${offset}`);
    },
    async listObjects(bucket, prefix, offset) {
      return json(`/storage/v1/object/list/${encodeURIComponent(bucket)}`, { prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    },
    async download(bucket, path) {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(new URL(`/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`, endpoint), {
        headers, signal: AbortSignal.timeout(180000),
      });
      if (!response.ok || !response.body) throw new Error('Storage download failed');
      return response;
    },
  };
}

async function* pages(list) {
  for (let offset = 0; ; offset += 100) {
    const items = await list(offset);
    if (!Array.isArray(items)) throw new Error('Invalid Storage listing');
    yield* items;
    if (items.length < 100) break;
  }
}

export async function backupStorage(root, key, client) {
  const objects = [];
  for await (const bucket of pages(offset => client.listBuckets(offset))) {
    if (typeof bucket?.name !== 'string' || !bucket.name) throw new Error('Invalid bucket listing');
    const prefixes = [''];
    const visited = new Set();
    while (prefixes.length) {
      const prefix = prefixes.pop();
      if (visited.has(prefix)) throw new Error('Duplicate Storage folder');
      visited.add(prefix);
      for await (const entry of pages(offset => client.listObjects(bucket.name, prefix, offset))) {
        if (typeof entry?.name !== 'string' || !entry.name || entry.name.includes('/')) throw new Error('Invalid Storage entry');
        const path = `${prefix}${entry.name}`;
        if (entry.id == null) { prefixes.push(`${path}/`); continue; }
        const response = await client.download(bucket.name, path);
        const chunks = await archiveStream(root, key, response.body);
        objects.push({ bucket: bucket.name, path, contentType: entry.metadata?.mimetype || response.headers?.get('content-type') || 'application/octet-stream', chunks });
      }
    }
  }
  return objects;
}

export async function createBackup(root, key, { database, storage }) {
  const chunks = await database();
  const objects = await backupStorage(root, key, storage);
  return writeManifest(root, key, { version: 1, createdAt: new Date().toISOString(), database: { format: 'pg_dump-custom', chunks }, objects });
}
