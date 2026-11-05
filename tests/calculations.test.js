import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, distribute, newRideBill, validateBill, UNASSIGNED } from '../shared/calculations.js';
import { billWithTax as newBill } from './helpers/bills.js';
import { parseReceipt } from '../shared/parser.js';

function fixture() { const b = newBill('ali'); b.title = 'Dinner'; b.participants = ['ali','sara','hamza']; b.items = [{ id: 'food', name: 'Platters', quantity: 3, unitPriceCents: 800000, eligible: true, allocations: [{ personId: 'ali', quantity: 1 }, { personId: 'sara', quantity: 1 }, { personId: 'hamza', quantity: 1 }] }, { id: 'drinks', name: 'Drinks', quantity: 6, unitPriceCents: 100000, eligible: true, allocations: [{ personId: 'ali', quantity: 1 }, { personId: 'sara', quantity: 2 }, { personId: 'hamza', quantity: 3 }] }]; return b; }
test('50% on the first Rs 20k of a Rs 30k bill gives Rs 20k payable', () => { const b = fixture(); b.discount = { ...b.discount, type: 'percent', rate: 50, eligibleCapCents: 2000000 }; const r = calculate(b); assert.equal(r.subtotal, 3000000); assert.equal(r.discount, 1000000); assert.equal(r.total, 2000000); assert.equal(r.shares.ali.total, 600000); assert.equal(r.shares.sara.total, 666667); assert.equal(r.shares.hamza.total, 733333); assert.equal(r.complete, true); });
test('eligibility cap differs from savings cap and excluded items get no discount', () => { const b = fixture(); b.items[1].eligible = false; b.discount = { ...b.discount, type: 'percent', rate: 50, eligibleCapCents: 2000000, maxDiscountCents: 500000 }; const r = calculate(b); assert.equal(r.discount, 500000); assert.equal(r.total, 2500000); assert.equal(r.shares.ali.discount + r.shares.sara.discount + r.shares.hamza.discount, 500000); });
test('tax bases, manual override, and extra fees recalculate', () => { const b = fixture(); b.discount = { ...b.discount, type: 'percent', rate: 50, eligibleCapCents: 2000000 }; b.tax = { type: 'percent', rate: 10, amountCents: 0, basis: 'after', confirmed: true }; b.deliveryCents = 30000; assert.equal(calculate(b).total, 2230000); b.tax.basis = 'before'; assert.equal(calculate(b).total, 2330000); b.items[0].lineTotalCents = 2000000; assert.equal(calculate(b).subtotal, 2600000); });
test('unassigned and over-assigned units cannot finalize even when free', () => { const b = fixture(); b.items[1].allocations.pop(); assert.equal(calculate(b).unassigned, 300000); assert.equal(calculate(b).complete, false); b.discount = { ...b.discount, type: 'percent', rate: 100 }; assert.equal(calculate(b).unassigned, 0); assert.equal(calculate(b).complete, false); b.items[1].allocations[0].quantity = 10; assert.ok(calculate(b).errors.length); });
test('receipt mismatch requires explicit reconciliation', () => { const b = fixture(); b.receiptTotalCents = 3000050; assert.equal(calculate(b).complete, false); b.adjustmentCents = 50; b.adjustmentReason = 'Rounding'; assert.equal(calculate(b).complete, true); });
test('one shared item can have fractional quantities with exact money allocation', () => { const b = fixture(); b.items = [{ id: 'pizza', name: 'Pizza', quantity: 1, unitPriceCents: 10000, allocations: b.participants.map(personId => ({ personId, quantity: 1 / 3 })) }]; assert.equal(calculate(b).complete, true); assert.deepEqual(Object.values(calculate(b).shares).map(s => s.total), [3334,3333,3333,0]); });
test('largest-remainder distribution conserves every paisa over many bills', () => { for (let i = 1; i < 500; i++) { const a = distribute(i * 71, { a: i % 17, b: i % 7, c: i % 3, d: 3 }); assert.equal(Object.values(a).reduce((s,v) => s+v,0), i * 71); const b = fixture(); b.items[0].unitPriceCents = i * 31; b.discount = { ...b.discount, type: 'percent', rate: 17.5 }; b.tax = { ...b.tax, type: 'percent', rate: 7.5 }; b.deliveryCents = i; b.chargeSplit = i % 2 ? 'equal' : 'proportional'; const r = calculate(b); assert.equal(Object.values(r.shares).reduce((s,v) => s+v.total,0), r.total); } });
test('invalid prices, duplicate allocations, missing adjustment reasons are rejected', () => { const b = fixture(); b.items[0].unitPriceCents = NaN; assert.throws(() => validateBill(b)); b.items[0].unitPriceCents = 100; b.items[0].allocations.push({ personId: 'ali', quantity: 1 }); assert.throws(() => validateBill(b)); b.items[0].allocations.pop(); b.adjustmentCents = 1; assert.throws(() => validateBill(b)); });
test('parser extracts quantities, discount, tax and total without an LLM', () => { const p = parseReceipt('Dinner House\nBurger 2 x 850 1700\nCold Drink 6 x 200 1200\nDiscount 20% -580\nGST 348\nDelivery 150\nTotal 2818'); assert.equal(p.items.length,2); assert.equal(p.items[1].quantity,6); assert.equal(p.items[1].unitPriceCents,20000); assert.equal(p.charges.discountCents,58000); assert.equal(p.charges.taxCents,34800); assert.equal(p.receiptTotalCents,281800); });
test('parser preserves printed line total discrepancies for review', () => { const p = parseReceipt('2 Zinger Burger 850 1701\nTotal 1701'); assert.equal(p.items[0].quantity,2); assert.equal(p.items[0].lineTotalCents,170100); });
test('inDrive fare stays equal when passengers or payer change, with exact rounding', () => {
  const ride = newRideBill('ali'); ride.participants=['ali','sara','hamza','usman']; ride.fareCents=120000;
  let result=calculate(ride); assert.equal(result.complete,true); assert.deepEqual(ride.participants.map(p=>result.shares[p].total),[30000,30000,30000,30000]);
  ride.participants.pop(); ride.paidBy='sara'; ride.fareCents=100001;
  result=calculate(ride); assert.deepEqual(ride.participants.map(p=>result.shares[p].total),[33334,33334,33333]); assert.equal(result.total-result.shares.sara.total,66667);
  ride.items=[]; ride.discount.type='fixed'; ride.discount.amountCents=99999;
  const canonical=validateBill(ride); assert.equal(canonical.items[0].allocations.length,3); assert.equal(canonical.discount.type,'none'); assert.equal(calculate(canonical).total,100001);
  ride.fareCents=-1; assert.throws(()=>validateBill(ride),/fare/);
});
test('multiple payers net their own shares and divide repayments between receivers', () => {
  const b = newRideBill('ali'); b.participants = ['ali', 'sara', 'hamza']; b.fareCents = 90000;
  b.payments = [{personId:'ali',amountCents:50000},{personId:'sara',amountCents:40000}];
  const r = calculate(validateBill(b));
  assert.equal(r.complete,true);
  assert.deepEqual(r.balances,{ali:20000,sara:10000,hamza:-30000});
  assert.deepEqual(r.transfers,[{debtorId:'hamza',creditorId:'ali',amount:20000},{debtorId:'hamza',creditorId:'sara',amount:10000}]);
  b.payments[0].amountCents = 10000; b.payments[1].amountCents = 80000;
  assert.deepEqual(calculate(b).transfers,[{debtorId:'ali',creditorId:'sara',amount:20000},{debtorId:'hamza',creditorId:'sara',amount:30000}]);
  b.payments[1].amountCents = 79000;
  assert.equal(calculate(b).complete,false); assert.equal(calculate(b).paymentDifference,1000); assert.deepEqual(calculate(b).transfers,[]);
  for(const payments of [[],[{personId:'other',amountCents:90000}],[{personId:'ali',amountCents:-1}],[{personId:'ali',amountCents:1.5}],[{personId:'ali',amountCents:1},{personId:'ali',amountCents:89999}]]) {
    assert.throws(()=>validateBill({...b,payments}));
  }
});
test('multi-payer settlement conserves every balance over 499 unequal, rounded bills', () => {
  for(let i=1;i<500;i++) {
    const b = fixture(); b.items[0].unitPriceCents=i*71;
    b.discount={...b.discount,type:'percent',rate:17.5}; b.tax={...b.tax,type:'percent',rate:7.5};
    const total=calculate(b).total;
    b.payments=[{personId:'ali',amountCents:Math.floor(total*i/500)},{personId:'sara',amountCents:total-Math.floor(total*i/500)}];
    const r=calculate(validateBill(b)); assert.equal(r.complete,true);
    const net={...r.balances};
    for(const t of r.transfers) { assert.notEqual(t.debtorId,t.creditorId); assert.ok(Number.isSafeInteger(t.amount)&&t.amount>0); net[t.debtorId]+=t.amount; net[t.creditorId]-=t.amount; }
    assert.ok(Object.values(net).every(x=>x===0));
  }
});

test('three equal or unequal original contributions calculate every repayment without self-payments', () => {
  const b = newRideBill('a'); b.participants=['a','b','c','d','e']; b.fareCents=900000;
  b.payments=['a','b','c'].map(personId=>({personId,amountCents:300000}));
  let result=calculate(validateBill(b));
  assert.equal(result.complete,true);
  assert.deepEqual(result.balances,{a:120000,b:120000,c:120000,d:-180000,e:-180000});
  assert.equal(result.transfers.length,6);assert.ok(result.transfers.every(t=>t.amount===60000));
  b.payments=[{personId:'a',amountCents:600000},{personId:'b',amountCents:200000},{personId:'c',amountCents:100000}];
  result=calculate(validateBill(b));
  assert.deepEqual(result.balances,{a:420000,b:20000,c:-80000,d:-180000,e:-180000});
  const net={...result.balances};
  for(const transfer of result.transfers){assert.notEqual(transfer.debtorId,transfer.creditorId);net[transfer.debtorId]+=transfer.amount;net[transfer.creditorId]-=transfer.amount;}
  assert.ok(Object.values(net).every(value=>value===0));
  assert.ok(result.transfers.some(t=>t.debtorId==='c'),'an original payer who underpaid still owes their remainder');
});
