import { remainingAmount, pendingAmount } from './payments.js';

const time = value => { const n = value ? Date.parse(value) : NaN; return Number.isFinite(n) ? n : null; };

// Each person's whole bill counts once, even when they repay several creditors
// or make partial/combined payments. Approval delay is not repayment delay.
export function buildScoreboard({ people, bills, debts, repayments, now = Date.now() }) {
  const published = new Map(bills.filter(b => b.status === 'published').map(b => [b.id, b]));
  const groups = new Map(), reports = new Map();
  for (const p of repayments) if (p.status === 'confirmed') {
    for (const a of p.allocations || []) {
      if (!reports.has(a.debtId)) reports.set(a.debtId, []);
      reports.get(a.debtId).push({ amount: a.amount, at: time(p.created_at) });
    }
  }
  for (const debt of debts) {
    if (!published.has(debt.bill_id) || debt.amount <= 0) continue;
    const key = JSON.stringify([debt.debtor_id, debt.bill_id]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(debt);
  }
  const scores = new Map(people.filter(p => p.claimed).map(p => [p.id, { personId: p.id, completedBills: 0, openBills: 0, pendingBills: 0, untrackedBills: 0, totalMs: 0, oldestOpenAt: null }]));
  for (const rows of groups.values()) {
    const score = scores.get(rows[0].debtor_id);
    if (!score) continue;
    const start = time(published.get(rows[0].bill_id).publishedAt) ?? time(rows[0].assigned_at);
    if (rows.some(d => remainingAmount(d) > 0)) {
      score.openBills++;
      if (rows.some(d => pendingAmount(d) > 0)) score.pendingBills++;
      if (start != null && start <= now && (score.oldestOpenAt == null || start < Date.parse(score.oldestOpenAt))) score.oldestOpenAt = new Date(start).toISOString();
      continue;
    }
    const finishes = rows.map(d => {
      const parts = reports.get(d.id) || [];
      if (parts.length && parts.every(p => p.at != null) && parts.reduce((sum, p) => sum + p.amount, 0) === d.amount) return Math.max(...parts.map(p => p.at));
      // Legacy single-payment debts can be timed only when their report timestamp exists.
      if (!parts.length && d.paid_amount == null && d.status === 'confirmed') return time(d.marked_paid_at);
      return null;
    });
    if (start == null || finishes.some(at => at == null || at < start || at > now)) { score.untrackedBills++; continue; }
    score.completedBills++;
    score.totalMs += Math.max(...finishes) - start;
  }
  return [...scores.values()].map(({ totalMs, ...row }) => ({ ...row, averageMs: row.completedBills ? Math.round(totalMs / row.completedBills) : null }))
    .sort((a, b) => (a.averageMs ?? Infinity) - (b.averageMs ?? Infinity) || b.completedBills - a.completedBills || a.personId.localeCompare(b.personId));
}

export function elapsedLabel(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'No score yet';
  if (ms < 60000) return 'Under 1 min';
  const minutes = Math.floor(ms / 60000), days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes} min`;
}
