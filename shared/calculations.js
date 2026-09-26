// All stored money is integer paisa. No model or OCR output does arithmetic.
export const UNASSIGNED = '__unassigned__';
export const money = cents => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100);
export const toCents = value => Math.round((Number(value) || 0) * 100);
export const id = () => {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  // randomUUID needs HTTPS; getRandomValues also works on a trusted local Wi-Fi URL.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
export function distribute(amount, weights) {
  const entries = Object.entries(weights).filter(([, value]) => value > 0);
  const sum = entries.reduce((s, [, value]) => s + value, 0);
  if (!sum) return { [UNASSIGNED]: amount };
  const sign = Math.sign(amount), absolute = Math.abs(amount);
  const rows = entries.map(([key, value], index) => {
    const exact = absolute * value / sum;
    return { key, value: Math.floor(exact), remainder: exact - Math.floor(exact), index };
  });
  let remainder = absolute - rows.reduce((s, row) => s + row.value, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) if (remainder-- > 0) row.value++;
  return Object.fromEntries(rows.map(row => [row.key, row.value * sign]));
}
export function newBill(personId) {
  return { title: '', date: new Date().toLocaleDateString('en-CA'), paidBy: personId, participants: [personId], items: [], discount: { type: 'none', rate: 0, amountCents: 0, eligibleCapCents: null, maxDiscountCents: null }, tax: { type: 'fixed', rate: 0, amountCents: 0, basis: 'after' }, deliveryCents: 0, serviceCents: 0, tipCents: 0, adjustmentCents: 0, adjustmentReason: '', chargeSplit: 'proportional', receiptTotalCents: null, receiptId: null };
}
export function newRideBill(personId) {
  return normalizeBill({ ...newBill(personId), kind: 'ride', title: 'inDrive ride', fareCents: 0 });
}
export function normalizeBill(bill) {
  if (bill?.kind !== 'ride') return bill;
  const participants = bill.participants || [];
  return {
    ...bill,
    items: [{ id: 'ride-fare', name: 'inDrive fare', quantity: Math.max(1, participants.length), unitPriceCents: 0, lineTotalCents: bill.fareCents, eligible: false, allocations: participants.map(personId => ({ personId, quantity: 1 })) }],
    discount: { type: 'none', rate: 0, amountCents: 0, eligibleCapCents: null, maxDiscountCents: null },
    tax: { type: 'fixed', rate: 0, amountCents: 0, basis: 'after' },
    deliveryCents: 0, serviceCents: 0, tipCents: 0, adjustmentCents: 0, adjustmentReason: '', chargeSplit: 'equal', receiptTotalCents: bill.fareCents, receiptId: null,
  };
}
export function calculate(bill) {
  bill = normalizeBill(bill);
  const errors = [], shares = {}, eligibleShares = {};
  const ensure = key => shares[key] ||= { items: 0, discount: 0, tax: 0, fees: 0, total: 0 };
  for (const person of bill.participants || []) ensure(person);
  ensure(UNASSIGNED);
  let subtotal = 0, eligibleSubtotal = 0, unassignedUnits = 0;
  for (const item of bill.items || []) {
    const total = item.lineTotalCents ?? Math.round(item.quantity * item.unitPriceCents);
    subtotal += total;
    if (item.eligible !== false) eligibleSubtotal += total;
    const weights = {};
    let assigned = 0;
    for (const allocation of item.allocations || []) {
      if (!(bill.participants || []).includes(allocation.personId)) { errors.push(`${item.name}: unknown participant`); continue; }
      assigned += allocation.quantity;
      weights[allocation.personId] = (weights[allocation.personId] || 0) + allocation.quantity;
    }
    if (assigned > item.quantity + 0.000001) errors.push(`${item.name || 'Item'} is over-assigned by ${(assigned - item.quantity).toFixed(2)} units.`);
    const remaining = Math.max(0, item.quantity - assigned);
    unassignedUnits += remaining;
    if (remaining > 0.000001) weights[UNASSIGNED] = remaining;
    for (const [person, value] of Object.entries(distribute(total, weights))) {
      ensure(person).items += value;
      if (item.eligible !== false) eligibleShares[person] = (eligibleShares[person] || 0) + value;
    }
  }
  const d = bill.discount || {};
  const eligibleBase = Math.min(eligibleSubtotal, d.eligibleCapCents ?? eligibleSubtotal);
  let discount = d.type === 'percent' ? Math.round(eligibleBase * d.rate / 100) : d.type === 'fixed' ? d.amountCents : 0;
  discount = Math.max(0, Math.min(discount || 0, eligibleBase, d.maxDiscountCents ?? Infinity));
  for (const [person, value] of Object.entries(distribute(discount, eligibleShares))) ensure(person).discount = value;
  const t = bill.tax || {}, taxable = t.basis === 'before' ? subtotal : subtotal - discount;
  const tax = t.type === 'percent' ? Math.round(taxable * (t.rate || 0) / 100) : t.amountCents || 0;
  const fees = (bill.deliveryCents || 0) + (bill.serviceCents || 0) + (bill.tipCents || 0) + (bill.adjustmentCents || 0);
  const discountedWeights = Object.fromEntries(Object.entries(shares).map(([p, s]) => [p, s.items - s.discount]));
  const beforeWeights = Object.fromEntries(Object.entries(shares).map(([p, s]) => [p, s.items]));
  const equalWeights = Object.fromEntries((bill.participants || []).map(p => [p, 1]));
  // Fully discounted bills still have a meaningful pre-discount basis for fixed charges.
  const proportionalWeights = Object.values(discountedWeights).some(v => v > 0) ? discountedWeights : beforeWeights;
  const taxWeights = t.basis === 'before' ? beforeWeights : proportionalWeights;
  for (const [p, value] of Object.entries(distribute(tax, taxWeights))) ensure(p).tax = value;
  for (const [p, value] of Object.entries(distribute(fees, bill.chargeSplit === 'equal' ? equalWeights : proportionalWeights))) ensure(p).fees = value;
  for (const [person, share] of Object.entries(shares)) {
    share.total = share.items - share.discount + share.tax + share.fees;
    if (share.total < 0) errors.push(`${person === UNASSIGNED ? 'Unassigned' : 'A participant’s'} share is negative. Reduce the adjustment.`);
  }
  const total = subtotal - discount + tax + fees;
  const unassigned = shares[UNASSIGNED].total;
  const receiptDifference = bill.receiptTotalCents == null ? 0 : bill.receiptTotalCents - total;
  return { subtotal, eligibleSubtotal, eligibleBase, discount, taxable, tax, fees, total, shares, unassigned, unassignedUnits, assigned: total - unassigned, receiptDifference, errors, complete: !errors.length && unassigned === 0 && unassignedUnits < 0.000001 && receiptDifference === 0 && total > 0 && (bill.items || []).length > 0 };
}
export function validateBill(bill) {
  if (!bill || typeof bill !== 'object') throw Error('Invalid bill.');
  const str = (v, max) => typeof v === 'string' && v.length <= max;
  const cents = (v, negative = false) => Number.isSafeInteger(v) && v >= (negative ? -10000000000 : 0) && v <= 10000000000;
  if (bill.kind != null && !['food', 'ride'].includes(bill.kind)) throw Error('Choose a food bill or an inDrive ride.');
  if (bill.kind === 'ride' && !cents(bill.fareCents)) throw Error('Enter a valid ride fare.');
  bill = normalizeBill(bill);
  if (!str(bill.title, 120) || !bill.title.trim()) throw Error('Give your bill a name.');
  if (!str(bill.date, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(bill.date)) throw Error('Enter a valid date.');
  if (!Array.isArray(bill.participants) || !bill.participants.length || bill.participants.length > 50 || new Set(bill.participants).size !== bill.participants.length) throw Error('Choose 1–50 unique participants.');
  if (!bill.participants.includes(bill.paidBy)) throw Error('The payer must be a participant.');
  if (!Array.isArray(bill.items) || bill.items.length > 200) throw Error('A bill can contain up to 200 items.');
  const ids = new Set();
  for (const item of bill.items) {
    if (!str(item.id, 100) || ids.has(item.id)) throw Error('Invalid or duplicate item.');
    ids.add(item.id);
    if (!str(item.name, 200) || !item.name.trim()) throw Error('Every item needs a name.');
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 10000) throw Error('Item quantities must be greater than zero.');
    if (!cents(item.unitPriceCents) || (item.lineTotalCents != null && !cents(item.lineTotalCents)) || !cents(item.lineTotalCents ?? Math.round(item.quantity * item.unitPriceCents))) throw Error('Enter valid item prices.');
    if (!Array.isArray(item.allocations) || item.allocations.length > 50 || new Set(item.allocations.map(a => a.personId)).size !== item.allocations.length) throw Error('Invalid item allocations.');
    for (const a of item.allocations) if (!bill.participants.includes(a.personId) || !Number.isFinite(a.quantity) || a.quantity < 0 || a.quantity > 10000) throw Error('Invalid assigned quantity.');
  }
  const d = bill.discount, t = bill.tax;
  if (!d || !['none', 'fixed', 'percent'].includes(d.type) || !Number.isFinite(d.rate) || d.rate < 0 || d.rate > 100 || !cents(d.amountCents) || (d.eligibleCapCents != null && !cents(d.eligibleCapCents)) || (d.maxDiscountCents != null && !cents(d.maxDiscountCents))) throw Error('Check your discount settings.');
  if (!t || !['fixed', 'percent'].includes(t.type) || !['before', 'after'].includes(t.basis) || !Number.isFinite(t.rate) || t.rate < 0 || t.rate > 100 || !cents(t.amountCents)) throw Error('Check your tax settings.');
  for (const k of ['deliveryCents', 'serviceCents', 'tipCents']) if (!cents(bill[k])) throw Error('Check your additional charges.');
  if (!cents(bill.adjustmentCents, true) || !str(bill.adjustmentReason || '', 200) || (bill.adjustmentCents !== 0 && !bill.adjustmentReason?.trim())) throw Error('Give your manual adjustment a reason.');
  if (!['equal', 'proportional'].includes(bill.chargeSplit) || (bill.receiptTotalCents != null && !cents(bill.receiptTotalCents))) throw Error('Invalid total or fee split.');
  const result = calculate(bill);
  if (!Number.isSafeInteger(result.total) || result.total > 10000000000 || result.subtotal > 10000000000) throw Error('Bill total is too large.');
  return bill;
}
