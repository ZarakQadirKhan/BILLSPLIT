import test from 'node:test';
import assert from 'node:assert/strict';
import { newBill, newRideBill, calculate, validateBill } from '../shared/calculations.js';
import { draftSnapshot } from '../src/drafts.js';
import { repeatBill } from '../src/repeat-bill.js';

const fixture = () => ({ ...newBill('a'), title:'Dinner', participants:['a','b','c'], items:[
  {id:'small',name:'Small order',quantity:1,unitPriceCents:50000,allocations:[{personId:'a',quantity:1}]},
  {id:'large',name:'Large order',quantity:1,unitPriceCents:150000,allocations:[{personId:'b',quantity:1}]},
] });

test('blank tax differs from explicit zero, survives drafts and cannot finalize', () => {
  const bill=fixture();
  assert.equal(calculate(bill).taxMissing,true);assert.equal(calculate(bill).complete,false);
  assert.equal(calculate(validateBill(bill)).complete,false,'incomplete drafts can save but not finalize');
  assert.equal(draftSnapshot(bill).tax.confirmed,false);
  bill.tax.confirmed=true;
  assert.equal(calculate(bill).complete,true);assert.equal(calculate(bill).tax,0);
  assert.equal(draftSnapshot(validateBill(bill)).tax.confirmed,true);
  assert.equal(calculate(repeatBill(bill)).taxMissing,true,'a new occasion needs a fresh tax entry');
  assert.throws(()=>validateBill({...bill,tax:{...bill.tax,confirmed:'yes'}}),/Confirm the tax/);
  delete bill.tax.confirmed;
  assert.equal(calculate(bill).complete,false,'legacy zero-tax drafts must be reviewed');
  assert.equal(calculate({...bill,status:'published'}).taxMissing,false,'published history is not reinterpreted');
  const ride=newRideBill('a');ride.fareCents=10000;assert.equal(calculate(ride).complete,true,'ride fares already include all charges');
});

test('tax follows each person’s order value even when additional fees are split equally', () => {
  const bill=fixture();bill.tax={...bill.tax,confirmed:true,amountCents:20000};bill.chargeSplit='equal';bill.deliveryCents=3000;
  let result=calculate(validateBill(bill));
  assert.deepEqual(['a','b','c'].map(p=>result.shares[p].tax),[5000,15000,0]);
  assert.deepEqual(['a','b','c'].map(p=>result.shares[p].fees),[1000,1000,1000]);
  assert.equal(result.total,223000);
  bill.tax={...bill.tax,type:'percent',rate:10};result=calculate(bill);
  assert.deepEqual(['a','b','c'].map(p=>result.shares[p].tax),[5000,15000,0]);
  bill.tax={...bill.tax,type:'fixed',amountCents:101};result=calculate(bill);
  assert.deepEqual(['a','b','c'].map(p=>result.shares[p].tax),[25,76,0]);
  assert.equal(Object.values(result.shares).reduce((sum,p)=>sum+p.tax,0),101);
  bill.discount={...bill.discount,type:'percent',rate:50};bill.items[1].eligible=false;
  bill.tax={...bill.tax,amountCents:7000,basis:'after'};result=calculate(bill);
  assert.deepEqual(['a','b','c'].map(p=>result.shares[p].tax),[1000,6000,0],'discounted food shares form the after-discount basis');
});
