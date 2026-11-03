import { confirmedAmount, pendingAmount, payableAmount, paymentStatus } from '../shared/payments.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function createRepaymentService(db,mail,event) {
  async function report(user,body) {
    const {debtIds,amountCents,requestId}=body;
    if(!Array.isArray(debtIds)||!debtIds.length||debtIds.length>100||debtIds.some(x=>typeof x!=='string')||new Set(debtIds).size!==debtIds.length) fail('Choose up to 100 unique payments.');
    if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>10000000000) fail('Enter a valid payment amount greater than zero.');
    if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(requestId)) fail('Refresh the payment form and try again.');
    const id=`${user.id}:${requestId}`,reference=clean(body.reference,200);
    return db.transaction(async()=>{
      const existing=await db.one('repayments',{id});
      if(existing) {
        if(existing.amount!==amountCents||JSON.stringify(existing.requestedDebtIds)!==JSON.stringify(debtIds)||existing.reference!==reference) fail('This payment request was already used. Reopen the form.',409);
        return existing;
      }
      const debts=[];
      for(const id of debtIds) {
        const d=await db.one('debts',{id});
        if(!d||d.debtor_id!==user.id) fail('You can only report your own repayments.',403);
        if(debts.length&&d.creditor_id!==debts[0].creditor_id) fail('A combined payment must go to one person.');
        debts.push(d);
      }
      if(amountCents>debts.reduce((s,d)=>s+payableAmount(d),0)) fail('This amount exceeds what is still payable. Refresh your balances.',409);
      let left=amountCents; const allocations=[];
      for(const d of debts) {
        const amount=Math.min(left,payableAmount(d)); if(!amount) continue;
        const paid=confirmedAmount(d),pending=pendingAmount(d)+amount;
        allocations.push({debtId:d.id,billId:d.bill_id,amount}); left-=amount;
        await db.update('debts',{id:d.id},{$set:{paid_amount:paid,pending_amount:pending,status:paymentStatus(d.amount,paid,pending),reference,marked_paid_at:new Date().toISOString(),updated_at:new Date().toISOString()}});
      }
      const payment={id,debtor_id:user.id,creditor_id:debts[0].creditor_id,amount:amountCents,allocations,requestedDebtIds:debtIds,reference,note:'',status:'pending',created_at:new Date().toISOString()};
      await db.insert('repayments',payment);
      await event(payment.creditor_id,allocations[0].billId,`${user.name} reported a payment. Please confirm the amount received.`);
      await mail.queueRepayment('approval',payment,payment.creditor_id);
      return payment;
    });
  }
  async function decide(user,id,action,note) {
    return db.transaction(async()=>{
      const p=await db.one('repayments',{id});
      if(!p||p.creditor_id!==user.id) fail('Only the recipient can confirm this payment.',403);
      if(!['confirm','reject'].includes(action)) fail('Choose confirm or not received.');
      if(p.status!=='pending') fail('This payment has already been reviewed.',409);
      const explanation=clean(note,500);
      if(action==='reject'&&!explanation) fail('Add a short explanation.');
      for(const a of p.allocations) {
        const d=await db.one('debts',{id:a.debtId});
        if(!d||d.creditor_id!==p.creditor_id||d.debtor_id!==p.debtor_id||pendingAmount(d)<a.amount) fail('Payment records changed. Refresh and try again.',409);
        const paid=confirmedAmount(d)+(action==='confirm'?a.amount:0),pending=pendingAmount(d)-a.amount;
        if(paid>d.amount) fail('Payment exceeds the original share.',409);
        await db.update('debts',{id:d.id},{$set:{paid_amount:paid,pending_amount:pending,status:paymentStatus(d.amount,paid,pending),note:explanation||d.note,updated_at:new Date().toISOString(),...(action==='confirm'?{confirmed_at:new Date().toISOString()}: {})}});
      }
      const updated={...p,status:action==='confirm'?'confirmed':'rejected',note:explanation,reviewed_at:new Date().toISOString()};
      await db.update('repayments',{id},{$set:{status:updated.status,note:explanation,reviewed_at:updated.reviewed_at}});
      await event(p.debtor_id,p.allocations[0].billId,`${user.name} ${action==='confirm'?'confirmed your payment':'could not confirm your payment'}.`);
      await mail.queueRepayment(action==='confirm'?'confirmed':'rejected',updated,p.debtor_id);
      if(action==='confirm') await mail.queueRepayment('confirmed',updated,p.creditor_id);
      return updated;
    });
  }
  // Old pending records have no repayment document. New multi-bill claims must be
  // confirmed together, never silently through a single old-client debt button.
  async function decideDebt(user,debt,action,note) {
    let claims=await db.many('repayments',{status:'pending','allocations.debtId':debt.id});
    if(!claims.length&&debt.status==='marked_paid'&&debt.pending_amount==null) {
      const p={id:`legacy-${debt.id}`,debtor_id:debt.debtor_id,creditor_id:debt.creditor_id,amount:pendingAmount(debt),allocations:[{debtId:debt.id,billId:debt.bill_id,amount:pendingAmount(debt)}],status:'pending',reference:debt.reference||'',created_at:debt.marked_paid_at||debt.updated_at};
      await db.insert('repayments',p); claims=[p];
    }
    if(claims.length!==1||claims[0].allocations.length!==1) fail('Open your dashboard to review the complete payment report.',409);
    return decide(user,claims[0].id,action,note);
  }
  return {report,decide,decideDebt};
}
