// Explicit live test: uses configured OpenAI credit and the SAME persistent budget
// as production. Does not create users, bills, debts, emails, or store receipt images.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/database.js';
import { createOpenAIReceiptScanner } from '../server/openai-receipt.js';

const args=process.argv.slice(2), filename=args.find(arg=>!arg.startsWith('--'));
if(!filename || !args.includes('--confirm-paid-test')) {
  console.error('Usage: node --env-file=<private-env> scripts/test-receipt.mjs <receipt.jpg> --confirm-paid-test [--check-sample]');
  process.exit(1);
}
if(!process.env.OPENAI_API_KEY || !process.env.MONGODB_URI) {
  console.error('Missing private OpenAI/database settings. No request made.'); process.exit(1);
}
let db, stage='read_photo';
try {
  const bytes=await readFile(filename);
  if(bytes.length>2*1024*1024 || bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255) throw Error('Expected a JPEG under 2 MB');
  stage='database_setup';
  db=await openDatabase();
  console.info('Starting one live two-stage scan; no bill or photo will be saved.');
  const started=Date.now();
  stage='scan';
  const result=await createOpenAIReceiptScanner(db)(bytes,'image/jpeg','owner-receipt-diagnostic');
  console.info(JSON.stringify({source:result.source,reason:result.reason,seconds:(Date.now()-started)/1000,usage:result.usage},null,2));
  if(result.source!=='openai') process.exitCode=1;
  else {
    const {receipt,transcription}=result;
    console.info('TRANSCRIPTION\n'+transcription);
    console.info('VALIDATED RESULT\n'+JSON.stringify({
      items:receipt.items.map(({name,quantity,unitPriceCents,lineTotalCents})=>({name,quantity,unitPrice:unitPriceCents/100,lineTotal:lineTotalCents==null?null:lineTotalCents/100})),
      subtotal:receipt.items.reduce((sum,item)=>sum+(item.lineTotalCents??Math.round(item.quantity*item.unitPriceCents)),0)/100,
      charges:receipt.charges,receiptTotalCents:receipt.receiptTotalCents,paymentOptions:receipt.paymentOptions,warnings:receipt.warnings,
    },null,2));
    if(args.includes('--check-sample')) {
      // Ground truth for the owner-supplied nine-row photo. Never sent to models.
      try {
        assert.deepEqual(receipt.items.map(i=>[i.quantity,i.lineTotalCents]),[
          [2,1200000],[1,157500],[1,9500],[1,25000],[2,50000],
          [1,25000],[1,9500],[2,100000],[1,35000],
        ]);
        assert.equal(receipt.items.reduce((sum,i)=>sum+i.lineTotalCents,0),1611500);
        assert.equal(receipt.charges.taxCents,null);
        assert.equal(receipt.charges.taxRate,null);
        assert.equal(receipt.receiptTotalCents,null);
        assert.match(receipt.warnings.join(' '),/card/i);
        assert.match(receipt.warnings.join(' '),/cash/i);
        assert.equal(receipt.paymentOptions.find(o=>/card/i.test(o.label))?.taxCents,80575);
        assert.equal(receipt.paymentOptions.find(o=>/cash/i.test(o.label))?.taxCents,257840);
        console.info('SAMPLE CHECK: PASS — all nine quantities and line totals, subtotal, and selectable card/cash tax alternatives match.');
      } catch {
        console.error('SAMPLE CHECK: FAIL — compare the displayed extraction with the original receipt.');
        process.exitCode=1;
      }
    }
  }
} catch(error) {
  const code=Number.isInteger(error.code) ? error.code : ['ENOENT','EACCES','ENOTFOUND','ECONNREFUSED','ETIMEOUT'].includes(error.code) ? error.code : 'unknown';
  console.error(JSON.stringify({event:'live_test_failed',stage,code}));
  process.exitCode=1;
} finally { if(db) await db.close(); }
