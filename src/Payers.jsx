import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { money } from '../shared/calculations.js';
import { MoneyInput } from './ui.jsx';

export const receiversReady = (result, people) => result.transfers.every(t => {
  const p = people.find(p => p.id === t.creditorId);
  return p?.claimed && !!p.paymentDetails?.trim();
});

export function PayerPicker({ bill, result, people, change, onProfile }) {
  const participants = people.filter(p => bill.participants.includes(p.id));
  const multiple = Array.isArray(bill.payments);
  const update = payments => change({ payments, paidBy: payments[0]?.personId || bill.paidBy });
  const available = participants.filter(p => !result.payments.some(payment => payment.personId === p.id));
  return <div className="payer-select">
    <h3>Who paid?</h3>
    <div className="tabs" role="group" aria-label="Number of payers">
      <button type="button" className={!multiple ? 'active' : ''} aria-pressed={!multiple} onClick={() => change({ payments: null })}>One person</button>
      <button type="button" className={multiple ? 'active' : ''} aria-pressed={multiple} onClick={() => update(result.payments.map(p => ({ ...p })))}>Multiple people</button>
    </div>
    {!multiple ? <label>Who paid the original bill?<select value={bill.paidBy} onChange={e => change({ paidBy: e.target.value })}>{participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : <>
      {result.payments.map((payment, i) => <div className="contribution-row" key={i}>
        <label>Payer {i + 1}<select value={payment.personId} onChange={e => update(bill.payments.map((p, j) => j === i ? { ...p, personId: e.target.value } : p))}>{participants.filter(p => p.id === payment.personId || !bill.payments.some(x => x.personId === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Amount paid<MoneyInput aria-label={`Payer ${i + 1} amount`} value={payment.amountCents} onChange={amountCents => update(bill.payments.map((p, j) => j === i ? { ...p, amountCents } : p))}/></label>
        <button type="button" className="icon-button" aria-label={`Remove payer ${i + 1}`} disabled={bill.payments.length < 2} onClick={() => update(bill.payments.filter((_, j) => j !== i))}><Trash2 size={18}/></button>
      </div>)}
      <button type="button" className="text-button" disabled={!available.length} onClick={() => update([...bill.payments, { personId: available[0].id, amountCents: Math.max(0, result.paymentDifference) }])}><Plus size={16}/> Add another payer</button>
      <p className={result.paymentDifference ? 'notice' : 'footnote'} role="status">{result.paymentDifference > 0 ? `${money(result.paymentDifference)} still to account for` : result.paymentDifference < 0 ? `${money(-result.paymentDifference)} more than the bill total` : 'Contributions match the bill total.'}</p>
    </>}
    <small>Each person’s own share is deducted from what they paid. We calculate the remaining transfers.</small>
    {!receiversReady(result, people) && <p className="notice">Everyone receiving money needs to join and add transfer details. <button className="text-button" onClick={onProfile}>Your payment details</button></p>}
  </div>;
}

export function TransferSummary({ result, people }) {
  const name = id => people.find(p => p.id === id)?.name || 'Friend';
  return <div className="transfer-summary"><h3>Who pays whom</h3>
    {result.paymentDifference !== 0 ? <p>Match the contributions to the bill total first.</p> : result.unassignedUnits > 0.000001 ? <p>Assign every item to see the repayments.</p> : !result.complete ? <p>Resolve the bill warnings and final total to see the repayments.</p> : result.transfers.length ? result.transfers.map(t => <div className="share-preview" key={`${t.debtorId}:${t.creditorId}`}><span>{name(t.debtorId)} → {name(t.creditorId)}</span><strong>{money(t.amount)}</strong></div>) : <p>Everyone has covered their own share. No transfers needed.</p>}
  </div>;
}
