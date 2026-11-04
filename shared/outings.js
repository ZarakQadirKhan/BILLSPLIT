import {calculate} from './calculations.js';
import {payableAmount,pendingAmount,remainingAmount} from './payments.js';

export function summarizeOuting(outingId,bills,debts) {
  const included=bills.filter(b=>b.outingId===outingId),published=included.filter(b=>b.status==='published');
  const ids=new Set(published.map(b=>b.id)),rows=debts.filter(d=>ids.has(d.bill_id));
  const people={};
  const person=id=>people[id]??={paid:0,share:0,owe:0,owed:0,pendingOut:0,pendingIn:0};
  let total=0;
  for(const bill of published){const result=calculate(bill);total+=result.total;for(const p of result.payments)person(p.personId).paid+=p.amountCents;for(const id of bill.participants)person(id).share+=result.shares[id]?.total||0;}
  for(const debt of rows){person(debt.debtor_id).owe+=payableAmount(debt);person(debt.creditor_id).owed+=payableAmount(debt);person(debt.debtor_id).pendingOut+=pendingAmount(debt);person(debt.creditor_id).pendingIn+=pendingAmount(debt);}
  return {bills:included,published,debts:rows,people,total,drafts:included.length-published.length,pending:rows.reduce((s,d)=>s+pendingAmount(d),0),unpaid:rows.reduce((s,d)=>s+payableAmount(d),0),settled:published.length>0&&rows.every(d=>remainingAmount(d)===0)};
}
