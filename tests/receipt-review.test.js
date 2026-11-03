import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReceipt} from '../shared/receipt-schema.js';
import {calculate,newBill,validateBill} from '../shared/calculations.js';
import {chooseReceiptOption} from '../shared/receipt-review.js';
import {extractReceipt} from '../src/receipt-scan.js';

const options=[{label:'Card',taxCents:80575,taxRate:5,taxBasis:null,receiptTotalCents:null},{label:'Cash',taxCents:257840,taxRate:16,taxBasis:null,receiptTotalCents:1869340}];
test('unresolved receipt choices survive storage, block publishing, and recalculate on selection',()=>{
  const bill={...newBill('a'),title:'Dinner',items:[{id:'food',name:'Food',quantity:1,unitPriceCents:1611500,allocations:[{personId:'a',quantity:1}]}],receiptReview:{options,needsTotal:true,selectedOption:null}};
  assert.equal(calculate(bill).complete,false);assert.equal(calculate(bill).errors.length,2);
  const stored=validateBill({...bill,receiptReview:{...bill.receiptReview,photo:'SECRET',options:options.map(o=>({...o,photo:'SECRET'}))}});
  assert.ok(!JSON.stringify(stored).includes('SECRET'));
  assert.deepEqual(stored.receiptReview,bill.receiptReview);
  const card=chooseReceiptOption(stored,0);assert.equal(calculate(card).total,1692075);assert.equal(calculate(card).complete,false,'clipped total still requires actual charged amount');
  card.receiptTotalCents=1692075;assert.equal(calculate(card).complete,true);
  const cash=chooseReceiptOption(stored,1);assert.equal(calculate(cash).total,1869340);assert.equal(calculate(cash).complete,true);
  const manual=chooseReceiptOption(stored,'manual');assert.equal(calculate(manual).complete,false);manual.receiptTotalCents=1611500;assert.equal(calculate(manual).complete,true);
  stored.items[0].priceMissing=true;assert.equal(calculate({...stored,receiptReview:null}).complete,false);
  assert.equal(validateBill(stored).items[0].priceMissing,true);
  assert.throws(()=>validateBill({...stored,receiptReview:{...stored.receiptReview,selectedOption:90}}));
  assert.throws(()=>validateBill({...stored,receiptReview:{...stored.receiptReview,options:[{...options[0],taxCents:-1}]}}));
});

test('unknown prices stay unknown through server-to-browser validation instead of triggering OCR',async()=>{
  const receipt={title:'Dinner',items:[{name:'Pizza',quantity:1,unitPriceCents:null,lineTotalCents:null,eligible:true,uncertain:true}],charges:Object.fromEntries(['discountCents','discountRate','eligibleCapCents','maxDiscountCents','taxCents','taxRate','taxBasis','deliveryCents','serviceCents','tipCents'].map(k=>[k,null])),receiptTotalCents:null,paymentOptions:options,warnings:[]};
  const normalized=normalizeReceipt(receipt);assert.equal(normalized.items[0].priceMissing,true);
  const result=await extractReceipt(new Blob(['test'],{type:'image/jpeg'}),()=>{},{send:async()=>({source:'openai',receipt:normalized}),ocr:()=>assert.fail('valid unknown values must not trigger OCR')});
  assert.equal(result.source,'openai');assert.equal(result.parsed.items[0].priceMissing,true);assert.deepEqual(result.parsed.paymentOptions,options);
  const invalid=structuredClone(receipt);invalid.paymentOptions[0].taxCents='80575';assert.throws(()=>normalizeReceipt(invalid));
});
