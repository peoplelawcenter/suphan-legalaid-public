import { resolve } from 'node:path';
import { keyFromEnvironment, latestSnapshot, restoreSnapshot, verifySnapshot } from './archive.mjs';
import { createBackup, dumpDatabase, storageClient } from './create.mjs';

function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0 || !process.argv[at + 1] || process.argv[at + 1].startsWith('--')) throw new Error(`Missing --${name}`);
  return process.argv[at + 1];
}

async function main() {
  const action = process.argv[2];
  if (!['backup', 'verify', 'restore'].includes(action)) throw new Error('Usage: cli.mjs backup|verify|restore --root DIRECTORY [--snapshot FILE] [--destination DIRECTORY]');
  const root = resolve(option('root'));
  const key = keyFromEnvironment(process.env.BACKUP_KEY_HEX);
  if (action === 'backup') {
    if (!process.env.BACKUP_DATABASE_URL || !process.env.BACKUP_SUPABASE_URL || !process.env.BACKUP_SERVICE_ROLE_KEY) throw new Error('Missing backup connection settings');
    const storage = storageClient(process.env.BACKUP_SUPABASE_URL, process.env.BACKUP_SERVICE_ROLE_KEY);
    const name = await createBackup(root, key, { database: () => dumpDatabase(root, key, process.env.BACKUP_DATABASE_URL), storage });
    await verifySnapshot(root, key, name);
    process.stdout.write(`Encrypted snapshot verified: ${name}\n`);
    return;
  }
  const name = process.argv.includes('--snapshot') ? option('snapshot') : await latestSnapshot(root);
  if (action === 'verify') {
    await verifySnapshot(root, key, name);
    process.stdout.write(`Encrypted snapshot verified: ${name}\n`);
  } else {
    const destination = resolve(option('destination'));
    await restoreSnapshot(root, key, name, destination);
    process.stdout.write(`Restored to local destination: ${destination}\n`);
  }
}

main().catch(() => {
  process.stderr.write('Backup operation failed. Check configuration, permissions, and archive integrity.\n');
  process.exitCode = 1;
});
