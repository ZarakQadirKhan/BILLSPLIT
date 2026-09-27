import { collections } from './database.js';

// The caller must supply an opened read-only SQLite connection. Receipt blobs
// are deliberately not copied, and the original SQLite file is never modified.
export async function migrateLegacy(source, destination) {
  const rows = table => source.prepare(`SELECT * FROM ${table}`).all();
  const users = rows('users').map(user => {
    const { recovery_hash, ...rest } = user;
    return { ...rest, claimed: !!user.claimed, ...(recovery_hash ? { recovery_hash } : {}),
      ...(user.claimed ? { username: `user_${user.id.replace(/-/g, '').slice(0, 19)}` } : {}) };
  });
  const bills = rows('bills').map(row => {
    const parsed = JSON.parse(row.data);
    // Legacy application-generated bills contain only receipt IDs, not blobs.
    const { image, photo, receipt, receiptId, ...data } = parsed;
    return { ...row, data: { ...data, receiptId: null }, participants: data.participants };
  });
  const data = {
    users,
    sessions: rows('sessions').map(({ token_hash, ...row }) => ({ id: token_hash, ...row })),
    contacts: rows('contacts').map(row => ({ id: `${row.owner_id}:${row.person_id}`, ...row })),
    invitations: rows('invitations').map(({ token_hash, ...row }) => ({ id: token_hash, ...row })),
    bills,
    debts: rows('debts'),
    events: rows('events').map(row => ({ ...row, is_read: !!row.is_read })),
  };
  await destination.transaction(async () => {
    for (const table of collections) if ((await destination.many(table, {}, { limit: 1 })).length) throw Error('Migration requires an empty destination database.');
    for (const [table, docs] of Object.entries(data)) {
      for (let offset = 0; offset < docs.length; offset += 500) await destination.insertMany(table, docs.slice(offset, offset + 500));
      if ((await destination.many(table)).length !== docs.length) throw Error(`Migration count mismatch for ${table}.`);
    }
  });
  return Object.fromEntries(Object.entries(data).map(([table, docs]) => [table, docs.length]));
}
