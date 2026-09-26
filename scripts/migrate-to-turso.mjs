import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/database.js';

// Explicit one-time migration into an EMPTY database. Never logs row contents,
// tokens, account details, or receipt images. The original file stays untouched.
if (!process.argv.includes('--confirm')) {
  console.error('Stop the local app and back up data/ first. Then run: node --env-file=.env.local scripts/migrate-to-turso.mjs --confirm');
  process.exit(1);
}
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw Error('Set both Turso variables in .env.local first.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = new DatabaseSync(path.join(process.env.DATA_DIR || path.join(root, 'data'), 'tab-together.sqlite'), { readOnly: true });
const target = await openDatabase(undefined, { requireRemote: true });
const tables = ['users','sessions','contacts','invitations','bills','members','debts','events','receipts'];
try {
  for (const table of tables) if ((await target.get(`SELECT COUNT(*) AS count FROM ${table}`)).count !== 0) throw Error(`Destination ${table} is not empty. Refusing to overwrite or merge live data.`);
  const counts = {};
  for (const table of tables) {
    const rows = source.prepare(`SELECT * FROM ${table}`).all();
    // Keep individual transactions bounded; remove the empty destination and
    // restart the migration if it fails partway (never rerun into partial data).
    for (let i=0;i<rows.length;i+=50) await target.transaction(async()=>{
      const batch=rows.slice(i,i+50).map(row=>{
        const columns=Object.keys(row);
        return {sql:`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,args:Object.values(row)};
      });
      await target.batch(batch);
    });
    const copied=(await target.get(`SELECT COUNT(*) AS count FROM ${table}`)).count;
    if (copied!==rows.length) throw Error(`Count mismatch for ${table}.`);
    counts[table]=copied;
  }
  console.log('Migration verified (record counts only):',counts);
  console.log('Original local database preserved. On the new domain, use your saved recovery code to reopen the same account.');
} finally { source.close(); await target.close(); }
