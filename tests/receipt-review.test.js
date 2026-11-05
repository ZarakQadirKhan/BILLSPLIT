import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReceipt} from '../shared/receipt-schema.js';
import { calculate, validateBill } from '../shared/calculations.js';
import { billWithTax as newBill } from './helpers/bills.js';
import {extractReceipt} from '../src/receipt-scan.js';

const options=[{label:'Card',taxCents:80575,taxRate:5,taxBasis:null,receiptTotalCents:null},{label:'Cash',taxCents:257840,taxRate:16,taxBasis:null,receiptTotalCents:1869340}];
test('legacy payment options do not block manual tax or a calculated total; missing prices still do',()=>{
  const bill={...newBill('a'),title:'Dinner',items:[{id:'food',name:'Food',quantity:1,unitPriceCents:1611500,allocations:[{personId:'a',quantity:1}]}],receiptReview:{options,needsTotal:true,selectedOption:null}};
  assert.equal(calculate(bill).complete,true);assert.equal(calculate(bill).errors.length,0);
  const stored=validateBill({...bill,receiptReview:{...bill.receiptReview,photo:'SECRET',options:options.map(o=>({...o,photo:'SECRET'}))}});
  assert.ok(!JSON.stringify(stored).includes('SECRET'));
  assert.deepEqual(stored.receiptReview,bill.receiptReview);
  stored.tax.amountCents=80575;assert.equal(calculate(stored).total,1692075);assert.equal(calculate(stored).complete,true);
  stored.tax.amountCents=0;assert.equal(calculate(stored).total,1611500);assert.equal(calculate(stored).complete,true);
  stored.tax={type:'percent',rate:16,amountCents:0,basis:'after',confirmed:true};assert.equal(calculate(stored).total,1869340);
  stored.receiptTotalCents=1692075;assert.equal(calculate(stored).complete,false,'an explicitly entered receipt check still catches mismatches');
  stored.receiptTotalCents=null;
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
