import { distribute, id } from './calculations.js';

// Separate identical servings into ordinary bill rows, so every serving can have
// its own sharing group without introducing a second source of allocation maths.
export function separateServings(items, itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item || !Number.isInteger(item.quantity) || item.quantity < 2) throw Error('Choose an item with at least two whole servings.');
  if (items.length - 1 + item.quantity > 200) throw Error('This would exceed 200 bill items. Split a smaller group of servings instead.');
  const total = item.lineTotalCents ?? item.quantity * item.unitPriceCents;
  const amounts = distribute(total, Object.fromEntries(Array.from({ length: item.quantity }, (_, i) => [i, 1])));
  return items.flatMap(current => current.id !== itemId ? [current] : Array.from({ length: item.quantity }, (_, index) => ({
    ...item, id: id(), name: `${item.name.slice(0, 175)} · serving ${index + 1}`, quantity: 1,
    unitPriceCents: amounts[index], lineTotalCents: amounts[index], allocations: [],
  })));
}
