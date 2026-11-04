import test from 'node:test';
import assert from 'node:assert/strict';
import { separateServings } from '../shared/servings.js';
import { equalAllocations } from '../shared/allocations.js';
import { calculate, newBill, validateBill } from '../shared/calculations.js';
import { draftSnapshot } from '../src/drafts.js';
import { repeatBill } from '../src/repeat-bill.js';

test('identical meals can have independent two-person, three-person and solo sharing groups', () => {
  const item = { id: 'meal', name: 'Pasta', quantity: 2, unitPriceCents: 60000, eligible: true, allocations: [] };
  const bill = { ...newBill('a'), title: 'Dinner', participants: ['a','b','c','d','e'], items: separateServings([item], item.id) };
  bill.items[0].allocations = equalAllocations(1, ['a','b']);
  bill.items[1].allocations = equalAllocations(1, ['c','d','e']);
  let result = calculate(validateBill(bill));
  assert.equal(result.complete, true); assert.equal(result.total, 120000);
  assert.deepEqual(bill.participants.map(id => result.shares[id].total), [30000,30000,20000,20000,20000]);
  bill.items[1].allocations = [{ personId: 'c', quantity: 1 }];
  result = calculate(validateBill(bill));
  assert.deepEqual(bill.participants.map(id => result.shares[id].total), [30000,30000,60000,0,0]);
  assert.equal(result.complete, true);
  assert.equal(item.quantity, 2); assert.deepEqual(item.allocations, []);
  assert.notEqual(bill.items[0].id, bill.items[1].id);
  assert.deepEqual(draftSnapshot(bill).items.map(i => i.allocations), bill.items.map(i => i.allocations));
  assert.deepEqual(repeatBill(bill).items.map(i => i.allocations), bill.items.map(i => i.allocations));
});

test('separating servings preserves every paisa, discounts, missing-price checks and item limits', () => {
  const bill = { ...newBill('a'), title: 'Rounded dinner', items: [{ id:'rice', name:'Rice', quantity:3, unitPriceCents:3333, lineTotalCents:10000, eligible:false, priceMissing:true, allocations:[{personId:'a',quantity:3}] }] };
  bill.items = separateServings(bill.items, 'rice');
  assert.deepEqual(bill.items.map(i => i.lineTotalCents), [3334,3333,3333]);
  assert.ok(bill.items.every(i => !i.eligible && i.priceMissing && i.allocations.length === 0));
  assert.equal(calculate(bill).complete, false);
  bill.items.forEach(i => { i.priceMissing=false; i.allocations=[{personId:'a',quantity:1}]; });
  bill.discount = { ...bill.discount, type:'percent', rate:10 };
  assert.equal(calculate(validateBill(bill)).total,10000);
  assert.throws(() => separateServings([{...bill.items[0],quantity:1.5}], bill.items[0].id), /whole servings/);
  assert.throws(() => separateServings([{...bill.items[0],quantity:201}], bill.items[0].id), /200 bill items/);
  assert.throws(() => separateServings(bill.items, 'missing'));
});
