import React, { useState } from 'react';
import { ArrowRight, ArrowUpRight, ArrowDownLeft, CheckCheck, ChevronRight, Receipt, Car } from 'lucide-react';
import { money } from '../shared/calculations.js';
import { payableAmount, pendingAmount, confirmedAmount, repaymentCard } from '../shared/payments.js';
import { Avatar, Badge, Empty } from './ui.jsx';

export default function HomeOverview({ debts, repayments=[], user, person, bills, onOpen, onAction, onCreate, onBills, children }) {
  const [filter,setFilter]=useState('owe');
  const mine=debts.filter(d=>d.debtor_id===user.id||d.creditor_id===user.id);
  const legacy=mine.filter(d=>d.status==='marked_paid'&&d.pending_amount==null);
  const pending=[...repayments.filter(p=>p.status==='pending').map(repaymentCard),...legacy];
  const approvals=pending.filter(p=>p.creditor_id===user.id);
  const waiting=pending.filter(p=>p.debtor_id===user.id);
  const history=[...repayments.filter(p=>p.status==='confirmed').map(repaymentCard),...mine.filter(d=>d.status==='confirmed'&&d.paid_amount==null)];
  const total=key=>mine.filter(d=>d[key]===user.id).reduce((sum,d)=>sum+payableAmount(d),0);
  return <div className="simple-home">
    <div className="quick-create" aria-label="Create a shared expense">
      <button onClick={()=>onCreate('food')}><Receipt size={22}/><span><strong>Split a bill</strong><small>Scan a receipt</small></span><ArrowRight size={18}/></button>
      <button onClick={()=>onCreate('manual')}><Receipt size={22}/><span><strong>Manual bill</strong><small>Enter items without a photo</small></span><ArrowRight size={18}/></button>
      <button onClick={()=>onCreate('ride')}><Car size={22}/><span><strong>Split a ride</strong><small>One fare, shared equally</small></span><ArrowRight size={18}/></button>
    </div>
    <div className="simple-totals">
      <button onClick={()=>setFilter('owe')} aria-pressed={filter==='owe'}><span><ArrowUpRight size={18}/> You owe</span><strong>{money(total('debtor_id'))}</strong><small>Still to pay · excludes pending</small></button>
      <button onClick={()=>setFilter('owed')} aria-pressed={filter==='owed'}><span><ArrowDownLeft size={18}/> Owed to you</span><strong>{money(total('creditor_id'))}</strong><small>Not yet reported paid</small></button>
    </div>
    {approvals.length>0&&<section className="card approval-card"><div className="section-heading"><h2>Did these payments arrive?</h2><span className="count-pill">{approvals.length}</span></div><p className="muted">Confirm the amount received, not the original bill total.</p><BalanceList debts={approvals} user={user} person={person} bills={bills} filter="all" onOpen={onOpen} onConfirm={d=>onAction(d,'confirm')} onReject={d=>onAction(d,'reject')}/></section>}
    {waiting.length>0&&<button className="pending-summary" onClick={()=>setFilter('pending')}><span>Awaiting confirmation — don’t pay again</span><strong>{money(waiting.reduce((s,p)=>s+p.amount,0))}</strong></button>}
    <section className="card payment-list-card"><div className="section-heading"><h2>Your payments</h2></div>
      <div className="tabs payment-tabs" role="group" aria-label="Filter balances">{[['owe','You owe'],['owed','Owed to you'],['pending','Pending'],['paid','Paid']].map(([key,label])=><button key={key} aria-pressed={filter===key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</div>
      {['owe','owed'].includes(filter)?<GroupedBalances debts={mine} user={user} person={person} bills={bills} filter={filter} onOpen={onOpen} onPaid={d=>onAction(d,'paid')}/>:<BalanceList debts={filter==='pending'?waiting:history} user={user} person={person} bills={bills} filter="all" paidHistory={filter==='paid'} pendingHistory={filter==='pending'} onOpen={onOpen}/>}
    </section>
    {bills.length>0&&<section className="card"><div className="section-heading"><h2>Recent bills</h2><button className="text-button" onClick={onBills}>All bills <ArrowRight size={16}/></button></div>{children}</section>}
  </div>;
}

export function GroupedBalances({debts,user,person,bills,filter,onOpen,onPaid}) {
  const incoming=filter==='owed',groups=new Map();
  for(const d of debts) {
    if(d[incoming?'creditor_id':'debtor_id']!==user.id||!payableAmount(d)) continue;
    const other=d[incoming?'debtor_id':'creditor_id'];
    if(!groups.has(other))groups.set(other,[]); groups.get(other).push(d);
  }
  if(!groups.size)return <Empty icon={CheckCheck} title={incoming?'No outstanding payments here':'Nothing to pay'} text="Payments awaiting approval are shown separately."/>;
  return <div className="balance-list">{[...groups].map(([other,rows])=>{
    const amount=rows.reduce((sum,d)=>sum+payableAmount(d),0);
    return <section className="balance-entry friend-balance" key={other}>
      <div className="share-preview"><Avatar name={person(other).name}/><div className="row-description"><strong>{person(other).name}</strong><small>{incoming?'Owes you':'You owe'} · {new Set(rows.map(d=>d.bill_id)).size} bills</small></div><strong>{money(amount)}</strong></div>
      {rows.some(d => d.last_rejected_at) && <p className="notice">A payment wasn’t confirmed. The unpaid amount is back here; its original clock continues.</p>}
      <details><summary>Choose bills & see breakdown</summary>{rows.map(d=><button className="balance-row" key={d.id} onClick={()=>onOpen(d.bill_id)}><span>{bills.find(b=>b.id===d.bill_id)?.title||'Shared bill'}</span><strong>{money(payableAmount(d))}</strong><ChevronRight size={15}/></button>)}<small>You can select which bills to include in the payment form.</small></details>
      {!incoming&&<button className="button primary" onClick={()=>onPaid({...rows[0],id:`group-${other}`,debts:rows.map(d=>({...d,billTitle:bills.find(b=>b.id===d.bill_id)?.title||'Shared bill'})),amount,paid_amount:0,pending_amount:0,status:'assigned'})}>I’ve paid</button>}
    </section>;
  })}</div>;
}

export function BalanceList({debts,user,person,filter,bills,onOpen,onPaid,onConfirm,onReject,paidHistory=false,pendingHistory=false}) {
  const relevant=debts.filter(d=>(d.debtor_id===user.id||d.creditor_id===user.id)&&(filter==='all'||filter==='owe'&&d.debtor_id===user.id||filter==='owed'&&d.creditor_id===user.id));
  if(!relevant.length)return <Empty icon={CheckCheck} title={paidHistory?'No paid payments yet':pendingHistory?'Nothing awaiting confirmation':filter==='owe'?'Nothing to pay':'No outstanding payments here'} text={paidHistory?'Confirmed payments will appear here.':'Your payment updates will appear here.'}/>;
  return <div className="balance-list">{relevant.map((d,i)=>{
    const incoming=d.creditor_id===user.id,other=person(incoming?d.debtor_id:d.creditor_id);
    const amount=d.repaymentId?d.amount:paidHistory?confirmedAmount(d):d.status==='marked_paid'?pendingAmount(d):payableAmount(d);
    return <div className="balance-entry" key={d.id}>
      <button className="balance-row" onClick={()=>onOpen(d.bill_id)}><Avatar name={other.name} index={i}/><span className="row-description"><strong>{other.name}</strong><small>{d.allocations?.length>1?`${d.allocations.length} bill shares in one payment`:bills.find(b=>b.id===d.bill_id)?.title||'Shared bill'}</small></span><span className="row-amount"><small>{d.status==='confirmed'?incoming?'paid you':'you paid':d.status==='marked_paid'?'Awaiting confirmation':incoming?'owes you':'you owe'}</small><strong>{money(amount)}</strong></span><ChevronRight size={16}/></button>
      {d.allocations?.length>1&&<details><summary>Included bills</summary>{d.allocations.map(a=><p key={a.debtId}>{bills.find(b=>b.id===a.billId)?.title||'Shared bill'}: {money(a.amount)}</p>)}</details>}
      <div className="payment-row-actions"><Badge status={d.status}/>
        {!incoming&&!d.repaymentId&&payableAmount(d)>0&&onPaid&&<button className="button primary" onClick={()=>onPaid(d)}>I’ve paid</button>}
        {incoming&&d.status==='marked_paid'&&onConfirm&&<><button className="button primary" onClick={()=>onConfirm(d)}>Confirm received</button><button className="text-button" onClick={()=>onReject(d)}>Not received</button></>}
        {!incoming&&d.status==='marked_paid'&&<small>Waiting for {other.name} to confirm. Don’t send this amount again.</small>}
      </div>
    </div>;
  })}</div>;
}
