import { id, toCents } from './calculations.js';

// Conservative parser: every extraction is a draft requiring human review.
export function parseReceipt(text) {
  const items = [], warnings = [], charges = {};
  let title = '', receiptTotalCents = null;
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const raw of lines) {
    const line = raw.replace(/(?:PKR|RS\.?|₨)/gi, '').trim();
    const matches = [...line.matchAll(/-?\d[\d,]*(?:\.\d{1,2})?/g)];
    if (!matches.length) { if (!title && /^[a-z]/i.test(line) && !/receipt|invoice|welcome|thank|address|phone/i.test(line)) title = line.slice(0, 120); continue; }
    const last = matches.at(-1), amount = toCents(last[0].replaceAll(',', ''));
    if (/\b(sub\s*total|cash|change|balance|tender|card|order|table|invoice|receipt|phone|tel|date|time|ntn|strn|transaction)\b/i.test(line)) continue;
    if (/\b(grand\s*total|total\s*(due|payable|amount)?|net\s*(total|amount)|amount\s*due)\b/i.test(line)) { receiptTotalCents = Math.abs(amount); continue; }
    if (/discount|saving|promo|voucher/i.test(line)) {
      if (/%/.test(line) && matches.length === 1) { charges.discountRate = Number(matches[0][0]); warnings.push('Check the discount eligibility and cap.'); }
      else { charges.discountCents = Math.abs(amount); if (/%/.test(line)) warnings.push('Discount amount extracted; check it against the receipt.'); }
      continue;
    }
    if (/\b(gst|pst|sst|vat|tax)\b/i.test(line)) { if (/%/.test(line) && matches.length === 1) charges.taxRate = Number(matches[0][0]); else charges.taxCents = Math.abs(amount); continue; }
    if (/delivery|shipping/i.test(line)) { charges.deliveryCents = Math.abs(amount); continue; }
    if (/service|packaging/i.test(line)) { charges.serviceCents = (charges.serviceCents || 0) + Math.abs(amount); continue; }
    if (/\btip\b/i.test(line)) { charges.tipCents = Math.abs(amount); continue; }
    if (/qty|quantity|unit\s*price|description|rate\s+amount/i.test(line)) continue;
    let name, quantity = 1, unitPriceCents = Math.abs(amount), uncertain = true;
    const explicit = line.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*[x×@]\s*([\d,]+(?:\.\d{1,2})?)(?:\s+([\d,]+(?:\.\d{1,2})?))?$/i);
    const columns = line.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)$/);
    const leading = line.match(/^(\d+)\s+(.+?[a-z].*?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)$/i);
    if (explicit || columns) { const m = explicit || columns; name = m[1]; quantity = Number(m[2]); unitPriceCents = toCents(m[3].replaceAll(',', '')); uncertain = !explicit; }
    else if (leading) { quantity = Number(leading[1]); name = leading[2]; unitPriceCents = toCents(leading[3].replaceAll(',', '')); }
    else { name = line.slice(0, last.index).trim(); const q = name.match(/^([1-9]\d*)\s+(.+)$/); if (q) { quantity = Number(q[1]); name = q[2]; unitPriceCents = Math.round(Math.abs(amount) / quantity); } }
    name = (name || '').replace(/[.\-:]+$/, '').trim();
    if (!/[a-z]/i.test(name) || name.length < 2 || amount < 0 || quantity <= 0 || quantity > 10000) { warnings.push(`Review this line: ${raw}`); continue; }
    const lineTotal = explicit && !explicit[4] ? Math.round(quantity * unitPriceCents) : Math.abs(amount);
    items.push({ id: id(), name, quantity, unitPriceCents, lineTotalCents: lineTotal === Math.round(quantity * unitPriceCents) ? null : lineTotal, eligible: true, allocations: [], uncertain });
  }
  if (!items.length) warnings.push('No food items were recognized. Add them manually or try a clearer photo.');
  if (receiptTotalCents == null) warnings.push('No final total found. Enter the amount charged from the receipt.');
  return { title, items, charges, receiptTotalCents, warnings };
}
