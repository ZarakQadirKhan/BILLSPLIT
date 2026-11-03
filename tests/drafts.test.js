import test from 'node:test';
import assert from 'node:assert/strict';
import {writeDraft,readDrafts,removeDraft} from '../src/drafts.js';
import {newBill} from '../shared/calculations.js';
test('device drafts restore incomplete bills, isolate users and never persist image or secret fields',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const b={...newBill('ali'),title:'Unfinished',image:'SECRET',transcription:'SECRET',apiKey:'SECRET',items:[{id:'one',name:'',quantity:1,unitPriceCents:0,priceMissing:true,allocations:[],photo:'SECRET'}]};
  writeDraft('ali','one',b,storage);assert.equal(readDrafts('ali',storage)[0].bill.items[0].name,'');
  assert.equal(readDrafts('sara',storage).length,0);assert.ok(!JSON.stringify([...values]).includes('SECRET'));
  writeDraft('ali','one',{...b,title:'Edited'},storage);assert.equal(readDrafts('ali',storage).length,1);assert.equal(readDrafts('ali',storage)[0].bill.title,'Edited');
  writeDraft('ali','two',b,storage);removeDraft('ali','one',storage);assert.equal(readDrafts('ali',storage)[0].id,'two');
  assert.throws(()=>writeDraft('ali','one',b,{getItem:()=>null,setItem(){throw Error('Full');}}),/Full/);
});
