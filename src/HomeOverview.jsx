import React, { useState } from 'react';
import { ArrowRight, ArrowUpRight, ArrowDownLeft, CheckCheck, ChevronRight, Receipt, Car } from 'lucide-react';
import { money } from '../shared/calculations.js';
import { Avatar, Badge, Empty } from './ui.jsx';

export default function HomeOverview({ debts, user, person, bills, onOpen, onAction, onCreate, onBills, children }) {
  const [filter, setFilter] = useState('owe');
  const mine = debts.filter(d => d.debtor_id === user.id || d.creditor_id === user.id);
  const open = mine.filter(d => d.status !== 'confirmed');
  const approvals = open.filter(d => d.creditor_id === user.id && d.status === 'marked_paid');
  const total = key => open.filter(d => d[key] === user.id).reduce((sum, d) => sum + d.amount, 0);
  return <div className="simple-home">
    <div className="quick-create" aria-label="Create a shared expense">
      <button onClick={() => onCreate('food')}><Receipt size={22}/><span><strong>Split a bill</strong><small>Scan a receipt or enter items</small></span><ArrowRight size={18}/></button>
      <button onClick={() => onCreate('ride')}><Car size={22}/><span><strong>Split a ride</strong><small>One fare, shared equally</small></span><ArrowRight size={18}/></button>
    </div>
    <div className="simple-totals">
      <button onClick={() => setFilter('owe')} aria-pressed={filter === 'owe'}><span><ArrowUpRight size={18}/> You owe</span><strong>{money(total('debtor_id'))}</strong></button>
      <button onClick={() => setFilter('owed')} aria-pressed={filter === 'owed'}><span><ArrowDownLeft size={18}/> Owed to you</span><strong>{money(total('creditor_id'))}</strong></button>
    </div>
    {approvals.length > 0 && <section className="card approval-card"><div className="section-heading"><h2>Did these payments arrive?</h2><span className="count-pill">{approvals.length}</span></div><p className="muted">Check your bank, wallet or cash before confirming.</p><BalanceList debts={approvals} user={user} person={person} bills={bills} filter="all" onOpen={onOpen} onConfirm={d => onAction(d, 'confirm')} onReject={d => onAction(d, 'reject')}/></section>}
    <section className="card payment-list-card"><div className="section-heading"><h2>Your payments</h2></div>
      <div className="tabs" role="group" aria-label="Filter balances">{[['owe', 'You owe'], ['owed', 'Owed to you'], ['paid', 'Paid']].map(([key, label]) => <button key={key} aria-pressed={filter === key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div>
      <BalanceList debts={filter === 'paid' ? mine.filter(d => d.status === 'confirmed') : open.filter(d => !approvals.includes(d))} user={user} person={person} bills={bills} filter={filter === 'paid' ? 'all' : filter} paidHistory={filter === 'paid'} onOpen={onOpen} onPaid={d => onAction(d, 'paid')}/>
    </section>
    {bills.length > 0 && <section className="card"><div className="section-heading"><h2>Recent bills</h2><button className="text-button" onClick={onBills}>All bills <ArrowRight size={16}/></button></div>{children}</section>}
  </div>;
}

export function BalanceList({ debts, user, person, filter, bills, onOpen, onPaid, onConfirm, onReject, paidHistory = false }) {
  const relevant = debts.filter(d => (d.debtor_id === user.id || d.creditor_id === user.id) && (filter === 'all' || filter === 'owe' && d.debtor_id === user.id || filter === 'owed' && d.creditor_id === user.id));
  if (!relevant.length) return <Empty icon={CheckCheck} title={paidHistory ? 'No paid payments yet' : filter === 'owe' ? 'Nothing to pay' : 'No outstanding payments here'} text={paidHistory ? 'Confirmed payments will appear here.' : 'New shares appear here when a bill is sent.'}/>;
  return <div className="balance-list">{relevant.map((d, i) => {
    const incoming = d.creditor_id === user.id, other = person(incoming ? d.debtor_id : d.creditor_id);
    return <div className="balance-entry" key={d.id}>
      <button className="balance-row" onClick={() => onOpen(d.bill_id)}><Avatar name={other.name} index={i}/><span className="row-description"><strong>{other.name}</strong><small>{bills.find(b => b.id === d.bill_id)?.title || 'Shared bill'}</small></span><span className="row-amount"><small>{d.status === 'confirmed' ? incoming ? 'paid you' : 'you paid' : incoming ? 'owes you' : 'you owe'}</small><strong>{money(d.amount)}</strong></span><ChevronRight size={16}/></button>
      <div className="payment-row-actions"><Badge status={d.status}/>
        {!incoming && ['assigned', 'accepted', 'disputed'].includes(d.status) && <button className="button primary" onClick={() => onPaid(d)}>I’ve paid</button>}
        {incoming && d.status === 'marked_paid' && onConfirm && <><button className="button primary" onClick={() => onConfirm(d)}>Confirm received</button><button className="text-button" onClick={() => onReject(d)}>Not received</button></>}
        {!incoming && d.status === 'marked_paid' && <small>Waiting for {other.name} to confirm.</small>}
      </div>
    </div>;
  })}</div>;
}
