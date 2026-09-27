import React, { useEffect, useState } from 'react';
import { ArrowLeft, Car, Users, Plus, Save, Send, Check, AlertCircle, Loader2 } from 'lucide-react';
import { calculate, normalizeBill, validateBill, money } from '../shared/calculations.js';
import { request } from './api.js';
import { Avatar, MoneyInput } from './ui.jsx';

export default function RideEditor({ initial, people, user, onAddFriend, onProfile, onClose, onSaved }) {
  const [bill, setBill] = useState(() => normalizeBill(structuredClone(initial)));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const change = patch => setBill(current => normalizeBill({ ...current, ...patch }));
  const result = calculate(bill), payer = people.find(p => p.id === bill.paidBy);
  const passengers = bill.participants.map(personId => people.find(p => p.id === personId)).filter(Boolean);
  useEffect(() => { const before = e => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', before); return () => window.removeEventListener('beforeunload', before); }, []);
  const toggle = personId => {
    if (personId === bill.paidBy) return;
    change({ participants: bill.participants.includes(personId) ? bill.participants.filter(p => p !== personId) : [...bill.participants, personId] });
  };
  async function save(publish) {
    setBusy(true); setError('');
    try {
      const valid = validateBill(bill);
      let saved = await request(bill.id ? `/bills/${bill.id}` : '/bills', { method: bill.id ? 'PUT' : 'POST', body: { bill: valid, version: bill.version } });
      setBill(saved);
      if (publish) saved = await request(`/bills/${saved.id}/publish`, { method: 'POST', body: { version: saved.version } });
      await onSaved(saved);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <>
    <button className="text-button back-button" onClick={() => window.confirm('Leave this ride? Save your draft first to keep recent changes.') && onClose()}><ArrowLeft size={16}/> Back to your space</button>
    <div className="page-heading"><div><div className="eyebrow">ONE RIDE. AN EQUAL SHARE.</div><h1>Split your inDrive<span>.</span></h1><p>Choose everyone in the car. We’ll divide the fare equally.</p></div><span className="ride-type-badge"><Car size={19}/> inDrive</span></div>
    {error && <div className="notice error" role="alert"><AlertCircle size={18}/>{error}</div>}
    <div className="editor-layout"><div className="editor-main">
      <section className="card"><h2>The ride</h2><div className="form-grid"><label>Ride name<input value={bill.title} onChange={e => change({ title: e.target.value })} maxLength={120} placeholder="e.g. inDrive · dinner to home"/></label><label>Date<input type="date" value={bill.date} onChange={e => change({ date: e.target.value })}/></label><label>Total fare paid<MoneyInput aria-label="Total ride fare" value={bill.fareCents} onChange={fareCents => change({ fareCents })}/></label></div><p className="muted">Enter the complete amount paid, including any tolls or tip.</p></section>
      <section className="card"><div className="section-heading"><h2><Users size={19}/> Who was in the car?</h2><button className="text-button" onClick={onAddFriend}><Plus size={16}/> Add a friend</button></div><div className="participant-picker">{people.map((p, i) => <button key={p.id} className={`participant-chip ${bill.participants.includes(p.id) ? 'selected' : ''}`} aria-pressed={bill.participants.includes(p.id)} onClick={() => toggle(p.id)}><Avatar name={p.name} index={i} small/>{p.name}{p.username && <small>@{p.username}</small>}{p.id === user.id ? ' (you)' : ''}{bill.participants.includes(p.id) && <Check size={15}/>}</button>)}</div><div className="payer-select"><label>Who paid the driver?<select value={bill.paidBy} onChange={e => change({ paidBy: e.target.value })}>{passengers.map(p => <option key={p.id} value={p.id}>{p.name}{p.username ? ` (@${p.username})` : ''}{p.id === user.id ? ' (you)' : ''}</option>)}</select></label><small>The payer is included in the equal split. Their own share never becomes a payment request.</small></div>{!payer?.claimed ? <div className="notice"><AlertCircle size={17}/>The payer needs to accept their invitation first.</div> : !payer.paymentDetails && <div className="notice"><AlertCircle size={17}/><span>{payer.id === user.id ? 'Add your transfer details so the passengers can pay you.' : `${payer.name} needs to add their transfer details.`}</span>{payer.id === user.id && <button className="text-button" onClick={onProfile}>Add details</button>}</div>}</section>
      <section className="card"><div className="section-heading"><h2>Passengers’ shares</h2><span className="badge">Split equally · {passengers.length} {passengers.length === 1 ? 'person' : 'people'}</span></div>{passengers.map((p, i) => <div className="share-preview" key={p.id}><Avatar name={p.name} index={i}/><div className="row-description"><strong>{p.name}{p.id === user.id && ' (you)'}</strong><small>{p.id === bill.paidBy ? 'Own share · no transfer needed' : `Owes ${payer?.name}`}</small></div><strong>{money(result.shares[p.id]?.total || 0)}</strong></div>)}<p className="footnote">When the fare doesn’t divide exactly, a leftover paisa goes to the first selected passengers. The shares always add up to the fare.</p></section>
    </div><aside className="editor-summary"><section className="card summary-card"><h2>The fare, settled</h2><div className="breakdown"><div><span>Total fare</span><strong>{money(result.total)}</strong></div><div><span>People in the car</span><strong>{passengers.length}</strong></div></div><div className="payer-summary"><span>{payer?.name} paid</span><strong>{money(result.total)}</strong><span>Their own share</span><strong>−{money(result.shares[bill.paidBy]?.total || 0)}</strong><span>They should receive</span><strong data-testid="ride-to-collect">{money(result.total - (result.shares[bill.paidBy]?.total || 0))}</strong></div><button className="button primary full" disabled={busy || !result.complete || !payer?.claimed || !payer?.paymentDetails} onClick={() => save(true)}>{busy ? <Loader2 className="spin" size={17}/> : <Send size={17}/>} Send ride shares</button><button className="button full" disabled={busy} onClick={() => save(false)}><Save size={17}/> Save as draft</button><p className="footnote">Each passenger sees who to pay. The payer sees everyone who owes them money.</p></section></aside></div>
  </>;
}
