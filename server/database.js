import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';

// Same schema locally and on Turso; existing local records remain compatible.
export const schema = [
  "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0, payment_details TEXT NOT NULL DEFAULT '', recovery_hash TEXT UNIQUE, created_at TEXT NOT NULL)",
  'CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id))',
  'CREATE TABLE IF NOT EXISTS contacts(owner_id TEXT NOT NULL REFERENCES users(id), person_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(owner_id, person_id))',
  'CREATE TABLE IF NOT EXISTS invitations(token_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES users(id), owner_id TEXT NOT NULL REFERENCES users(id))',
  'CREATE TABLE IF NOT EXISTS bills(id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS members(bill_id TEXT NOT NULL REFERENCES bills(id), user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(bill_id,user_id))',
  "CREATE TABLE IF NOT EXISTS debts(id TEXT PRIMARY KEY, bill_id TEXT NOT NULL REFERENCES bills(id), debtor_id TEXT NOT NULL REFERENCES users(id), creditor_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, status TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)",
  'CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), bill_id TEXT, message TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), content_type TEXT NOT NULL, bytes BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_debts_debtor ON debts(debtor_id)',
  'CREATE INDEX IF NOT EXISTS idx_debts_creditor ON debts(creditor_id)',
  'CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id,created_at)',
];

export async function openDatabase(directory, options = {}) {
  const url = options.url ?? process.env.TURSO_DATABASE_URL;
  const authToken = options.authToken ?? process.env.TURSO_AUTH_TOKEN;
  const cloudRequired = options.requireRemote ?? !!process.env.VERCEL;
  let client = options.client, sqlite;
  if (!client && url) {
    if (!authToken || !/^(libsql|https):\/\//.test(url)) throw Error('Set a valid TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
    const { createClient } = await import('@libsql/client/web');
    client = createClient({ url, authToken });
  } else if (!client) {
    if (cloudRequired) throw Error('Persistent database missing: configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel.');
    const { DatabaseSync } = await import('node:sqlite');
    mkdirSync(directory, { recursive: true });
    sqlite = new DatabaseSync(`${directory}/tab-together.sqlite`);
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  }
  if (client) await client.batch(schema, 'write');
  else sqlite.exec(schema.join(';') + '; PRAGMA optimize;');

  const context = new AsyncLocalStorage();
  let tail = Promise.resolve();
  // A local connection cannot interleave another request into an awaited transaction.
  function exclusive(fn) {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  }
  async function query(kind, sql, args) {
    const transaction = context.getStore();
    const execute = async () => {
      if (client) {
        const result = await (transaction || client).execute({ sql, args });
        return kind === 'get' ? result.rows[0] : kind === 'all' ? result.rows : { changes: result.rowsAffected };
      }
      return sqlite.prepare(sql)[kind](...args);
    };
    return sqlite && !transaction ? exclusive(execute) : execute();
  }
  return {
    kind: client ? 'turso' : 'sqlite',
    get: (sql, ...args) => query('get', sql, args),
    all: (sql, ...args) => query('all', sql, args),
    run: (sql, ...args) => query('run', sql, args),
    async batch(statements) {
      const tx = context.getStore();
      const execute = async () => {
        if (client) return (tx || client).batch(statements, ...(tx ? [] : ['write']));
        for (const { sql, args = [] } of statements) sqlite.prepare(sql).run(...args);
      };
      return sqlite && !tx ? exclusive(execute) : execute();
    },
    async transaction(fn, mode = 'write') {
      if (context.getStore()) return fn();
      const execute = async () => {
        const tx = client ? await client.transaction(mode) : { local: true };
        if (sqlite) sqlite.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN');
        try {
          const value = await context.run(tx, fn);
          if (client) await tx.commit(); else sqlite.exec('COMMIT');
          return value;
        } catch (error) {
          try { if (client) await tx.rollback(); else sqlite.exec('ROLLBACK'); } catch { /* preserve the original error */ }
          throw error;
        } finally { if (client) tx.close(); }
      };
      return sqlite ? exclusive(execute) : execute();
    },
    async close() { await tail; if (client) client.close(); else sqlite.close(); },
  };
}
