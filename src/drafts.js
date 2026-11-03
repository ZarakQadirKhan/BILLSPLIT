import { useEffect, useRef, useState } from 'react';
import { id } from '../shared/calculations.js';
const key=userId=>`tab-together-drafts:${userId}`;
const pick=(source,keys)=>Object.fromEntries(keys.filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
// Allowlist bill data. Photos, OCR text, model transcripts, credentials and blobs
// must never enter browser draft storage, even if supplied as extra properties.
export function draftSnapshot(bill) {
  const data=pick(bill,['id','version','creatorId','status','title','date','paidBy','participants','kind','fareCents','entryMode','deliveryCents','serviceCents','tipCents','adjustmentCents','adjustmentReason','chargeSplit','receiptTotalCents']);
  data.items=(bill.items||[]).map(i=>({...pick(i,['id','name','quantity','unitPriceCents','lineTotalCents','eligible','uncertain','priceMissing']),allocations:(i.allocations||[]).map(a=>pick(a,['personId','quantity']))}));
  data.discount=pick(bill.discount||{},['type','rate','amountCents','eligibleCapCents','maxDiscountCents']);
  data.tax=pick(bill.tax||{},['type','rate','amountCents','basis']);
  if(Array.isArray(bill.payments))data.payments=bill.payments.map(p=>pick(p,['personId','amountCents']));
  if(bill.receiptReview)data.receiptReview={...pick(bill.receiptReview,['needsTotal','selectedOption']),options:(bill.receiptReview.options||[]).map(o=>pick(o,['label','taxCents','taxRate','taxBasis','receiptTotalCents']))};
  return data;
}
export function readDrafts(userId,storage=localStorage) {
  try {const rows=JSON.parse(storage.getItem(key(userId))||'[]');return Array.isArray(rows)?rows.filter(r=>typeof r.id==='string'&&r.bill&&typeof r.bill==='object'):[];}catch{return [];}
}
export function writeDraft(userId,draftId,bill,storage=localStorage) {
  const rows=readDrafts(userId,storage).filter(r=>r.id!==draftId);
  const row={id:draftId,updatedAt:Date.now(),bill:{...draftSnapshot(bill),_localDraftId:draftId}};
  storage.setItem(key(userId),JSON.stringify([row,...rows]));
  if(typeof window!=='undefined')window.dispatchEvent(new window.Event('tab-drafts-changed'));
}
export function removeDraft(userId,draftId,storage=localStorage) {
  storage.setItem(key(userId),JSON.stringify(readDrafts(userId,storage).filter(r=>r.id!==draftId)));
  if(typeof window!=='undefined')window.dispatchEvent(new window.Event('tab-drafts-changed'));
}
export function useDraftAutosave(userId,bill) {
  const draftId=useRef(bill._localDraftId||bill.id||id()),latest=useRef(bill),cleared=useRef(false);
  latest.current=bill;
  const [message,setMessage]=useState('Saving on this device…');
  function flush(update=true) {
    if(cleared.current)return true;
    try {writeDraft(userId,draftId.current,latest.current);if(update)setMessage('Draft saved on this device');return true;}
    catch {if(update)setMessage('Could not autosave. Use Save draft before leaving.');return false;}
  }
  useEffect(()=>{setMessage('Saving on this device…');const timer=setTimeout(()=>flush(),300);return()=>clearTimeout(timer);},[bill]);
  useEffect(()=>{
    const background=()=>flush(false),unload=e=>{if(!flush(false)){e.preventDefault();e.returnValue='';}};
    window.addEventListener('pagehide',background);document.addEventListener('visibilitychange',background);window.addEventListener('beforeunload',unload);
    return()=>{flush(false);window.removeEventListener('pagehide',background);document.removeEventListener('visibilitychange',background);window.removeEventListener('beforeunload',unload);};
  },[userId]);
  return {message,flush,clear(){cleared.current=true;removeDraft(userId,draftId.current);}};
}
