import { buildScoreboard } from '../shared/scoreboard.js';

export async function readScoreboard(db, people, rows, debts, now = Date.now()) {
  const bills = rows.filter(b => b.status === 'published').map(b => ({ id: b.id, status: b.status, title: b.data.title, publishedAt: b.published_at }));
  const legacyIds = bills.filter(b => !b.publishedAt).map(b => b.id);
  // Existing bills can use their original server-written assignment notification.
  // Never infer a start from an editable bill date or last-updated timestamp.
  if (legacyIds.length) {
    const events = await db.many('events', { bill_id: { $in: legacyIds }, message: /: review your share and repayments\.$/ }, { projection: { _id: 0, bill_id: 1, message: 1, created_at: 1 }, sort: { created_at: 1 } });
    for (const bill of bills) if (!bill.publishedAt) bill.publishedAt = events.find(e => e.bill_id === bill.id && e.message === `${bill.title}: review your share and repayments.`)?.created_at;
  }
  const repayments = await db.many('repayments', { status: 'confirmed', 'allocations.billId': { $in: bills.map(b => b.id) } }, { projection: { _id: 0, status: 1, created_at: 1, allocations: 1 } });
  return buildScoreboard({ people, bills, debts, repayments, now });
}
