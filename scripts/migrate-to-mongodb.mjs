import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/database.js';
import { migrateLegacy } from '../server/migrate-legacy.js';

if (!process.argv.includes('--confirm')) {
  console.error('Back up data/ and stop the app first. Then run: node --env-file=.env.local scripts/migrate-to-mongodb.mjs --confirm');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = new DatabaseSync(path.join(root, 'data/tab-together.sqlite'), { readOnly: true });
let destination;
try {
  destination = await openDatabase();
  const counts = await migrateLegacy(source, destination);
  for (const [table, count] of Object.entries(counts)) console.log(`${table}: ${count} records migrated`);
  console.log('Migration complete. Local data and photos are unchanged. Photos were not uploaded. Existing members can change their generated username in Profile.');
} catch (error) {
  console.error('Migration failed; no data committed. Check your private database settings and that the destination is empty.', error.code || error.name);
  process.exitCode = 1;
} finally { source.close(); if (destination) await destination.close(); }
