import React,{useState} from 'react';
import {ArrowLeft,ChevronRight,MapPin,Plus,Receipt,CheckCheck,Pencil} from 'lucide-react';
import {money,calculate} from '../shared/calculations.js';
import {pendingAmount,payableAmount} from '../shared/payments.js';
import {summarizeOuting} from '../shared/outings.js';
import {Modal,Avatar,shortDate} from './ui.jsx';
import {GroupedBalances} from './HomeOverview.jsx';

export function OutingPicker({value,outings=[],participants=[],onChange}) {
  const selected=outings.find(o=>o.id===value),mismatch=selected&&participants.some(id=>!selected.members.includes(id));
  return <div className="outing-picker"><label>Outing or trip (optional)<select value={value||''} onChange={e=>onChange(e.target.value||null)}><option value="">Separate bill</option>{outings.map(o=><option value={o.id} key={o.id}>{o.title}</option>)}{value&&!selected&&<option value={value}>Unavailable outing — choose another</option>}</select></label>{value&&<p className={mismatch||!selected?'notice error':'muted'}>{mismatch?'Some people on this bill aren’t in this outing. Choose another outing or keep it separate.':!selected?'This outing is no longer available. Choose another or keep the bill separate.':'Publishing shares this bill with everyone in the outing. Drafts stay private.'}</p>}</div>;
}

export function CreateOuting({people,user,onClose,onSubmit}) {
  const [title,setTitle]=useState(''),[members,setMembers]=useState([user.id]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title="New outing or trip" onClose={()=>!busy&&onClose()}><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await onSubmit({title,members});}catch(e){setError(e.message);}finally{setBusy(false);}}}>
    <label>Outing name<input autoFocus required maxLength={120} placeholder="Saturday night, Hunza trip…" value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <fieldset className="outing-members"><legend>Who’s coming?</legend><div className="participant-picker">{people.map((p,i)=><button type="button" key={p.id} className={`participant-chip ${members.includes(p.id)?'selected':''}`} aria-pressed={members.includes(p.id)} disabled={p.id===user.id} onClick={()=>setMembers(current=>current.includes(p.id)?current.filter(id=>id!==p.id):[...current,p.id])}><Avatar name={p.name} index={i} small/>{p.name}{p.id===user.id?' (you)':''}</button>)}</div></fieldset>
    <p className="muted">Everyone selected can add expenses and see all published bills in this outing. Each bill can include just the people who shared it.</p>
    <p className="muted">Choose the full group now. You can select fewer people on individual bills.</p>
    {error&&<p className="notice error" role="alert">{error}</p>}<button className="button primary full" disabled={busy||!title.trim()||members.length>50}>{busy?'Creating…':'Create outing'}</button>
  </form></Modal>;
}

export function MoveBillOuting({bill,outings,onClose,onSubmit}) {
  const [outingId,setOutingId]=useState(bill.outingId||null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title="Organize this bill" onClose={()=>!busy&&onClose()}><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await onSubmit(outingId);}catch(e){setError(e.message);}finally{setBusy(false);}}}>
    <OutingPicker value={outingId} outings={outings} participants={bill.participants} onChange={setOutingId}/><p className="muted">Moving a bill keeps its amounts, shares and payment history.</p>
    {error&&<p className="notice error" role="alert">{error}</p>}<button className="button primary full" disabled={busy}>{busy?'Saving…':'Save outing'}</button>
  </form></Modal>;
}

export function AddExistingBill({outing,bills,user,onClose,onSubmit}) {
  const choices=bills.filter(b=>b.creatorId===user.id&&b.outingId!==outing.id&&b.participants.every(id=>outing.members.includes(id)));
  const [billId,setBillId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title={`Add a bill to ${outing.title}`} onClose={()=>!busy&&onClose()}><form onSubmit={async e=>{e.preventDefault();if(busy)return;const bill=choices.find(b=>b.id===billId);if(!bill)return;setBusy(true);try{await onSubmit(bill);}catch(e){setError(e.message);}finally{setBusy(false);}}}>
    <p className="muted">Choose a bill you created. Everyone on the bill must be in this outing. Published bills will be visible to the whole outing.</p>
    {choices.length?<label>Existing bill<select value={billId} onChange={e=>setBillId(e.target.value)} required><option value="">Choose a bill</option>{choices.map(b=><option key={b.id} value={b.id}>{b.title} · {shortDate(b.date)}{b.status==='draft'?' · Draft':''}</option>)}</select></label>:<p>No matching bills yet. Close this window and choose Add expense to create one.</p>}
    <p className="muted">A bill can belong to one outing. Moving it keeps all shares and repayment history.</p>{error&&<p className="notice error" role="alert">{error}</p>}<button className="button primary full" disabled={busy||!billId}>{busy?'Adding…':'Add to outing'}</button>
  </form></Modal>;
}

export function OutingList({outings,bills,debts,onOpen,onCreate}) {
  return <section className="outing-list"><div className="section-heading"><h2>Outings & trips</h2><button className="button" onClick={onCreate}><Plus size={17}/> New outing</button></div>
    {!outings.length?<div className="card outing-empty"><MapPin size={30}/><h3>One outing. Every expense.</h3><p>Keep dinner, rides and snacks together, even when different friends pay.</p><button className="button primary" onClick={onCreate}>Plan an outing</button></div>:<div className="outing-grid">{outings.map(o=>{const s=summarizeOuting(o.id,bills,debts);return <button className="card outing-tile" key={o.id} onClick={()=>onOpen(o.id)}><span className="outing-icon"><MapPin size={23}/></span><strong>{o.title}</strong><small>{o.members.length} people · {s.published.length} published {s.published.length===1?'bill':'bills'}{s.drafts?` · ${s.drafts} private draft${s.drafts===1?'':'s'}`:''}</small><b>{money(s.total)}</b><span>{s.settled?'Published bills settled ✨':s.pending?'Payments awaiting confirmation':s.unpaid?'Repayments still open':'Ready for your next expense'} <ChevronRight size={16}/></span></button>;})}</div>}
  </section>;
}

export function OutingDetails({outing,bills,debts,user,person,onBack,onOpen,onCreate,onRename,onAddExisting,onPaid}) {
  const s=summarizeOuting(outing.id,bills,debts),mine=s.people[user.id]||{owe:0,owed:0,pendingIn:0,pendingOut:0},[tab,setTab]=useState('owe');
  const pending=s.debts.filter(d=>(d.debtor_id===user.id||d.creditor_id===user.id)&&pendingAmount(d)>0);
  return <div className="outing-detail"><button className="text-button back-button" onClick={onBack}><ArrowLeft size={16}/> All outings</button>
    <div className="page-heading"><div><div className="eyebrow">ONE OUTING. EVERY EXPENSE.</div><h1>{outing.title}<span>.</span></h1><p>{outing.members.map(id=>person(id).name).join(', ')}</p></div>{outing.creatorId===user.id&&<button className="text-button" onClick={onRename}><Pencil size={16}/> Rename</button>}</div>
    <div className="outing-total"><span>Total spent</span><strong>{money(s.total)}</strong><small>{s.published.length} published bills · Drafts excluded</small>{s.settled&&<span><CheckCheck size={16}/> Published bills settled</span>}</div>
    <div className="outing-actions"><button className="button primary" onClick={onCreate}><Plus size={18}/> Add expense</button><button className="button" onClick={onAddExisting}>Add existing bill</button></div>
    <div className="simple-totals outing-balances"><button aria-pressed={tab==='owe'} onClick={()=>setTab('owe')}><span>You still need to pay</span><strong>{money(mine.owe)}</strong><small>{money(mine.pendingOut)} awaiting confirmation</small></button><button aria-pressed={tab==='owed'} onClick={()=>setTab('owed')}><span>Still to receive</span><strong>{money(mine.owed)}</strong><small>{money(mine.pendingIn)} awaiting your confirmation</small></button></div>
    <section className="card"><h2>{tab==='owe'?'Your repayments for this outing':'Repayments coming to you'}</h2><GroupedBalances debts={s.debts} bills={s.published} user={user} person={person} filter={tab} onOpen={onOpen} onPaid={onPaid}/>
      {pending.length>0&&<details className="outing-pending"><summary>Payments awaiting confirmation ({pending.length})</summary><p className="muted">Open the bill to review the payment report. Don’t pay the pending amount again.</p>{pending.map(d=><button className="balance-row" key={d.id} onClick={()=>onOpen(d.bill_id)}><span className="row-description"><strong>{person(d.debtor_id).name} → {person(d.creditor_id).name}</strong><small>{s.published.find(b=>b.id===d.bill_id)?.title}</small></span><strong>{money(pendingAmount(d))}</strong><ChevronRight size={16}/></button>)}</details>}
    </section>
    <section className="card"><h2>Who paid for the outing?</h2><p className="muted">Original bill payments and each person’s share, before repayments.</p><div className="outing-contributions"><div className="outing-contribution outing-table-head"><span>Friend</span><span>Paid</span><span>Share</span></div>{outing.members.map(id=><div className="outing-contribution" key={id}><strong>{person(id).name}</strong><span>{money(s.people[id]?.paid||0)}</span><span>{money(s.people[id]?.share||0)}</span></div>)}</div></section>
    <section className="card"><h2>Expenses</h2>{!s.bills.length?<p className="muted">Add the first meal, ride or other expense.</p>:s.bills.map(b=><button className="bill-row" key={b.id} onClick={()=>onOpen(b.id)}><span className="bill-icon"><Receipt size={18}/></span><span className="row-description"><strong>{b.title}</strong><small>{shortDate(b.date)} · {b.status==='draft'?'Private draft':`Paid by ${calculate(b).payments.map(p=>person(p.personId).name).join(' & ')}`}</small></span><strong>{money(calculate(b).total)}</strong><ChevronRight size={16}/></button>)}</section>
  </div>;
}
