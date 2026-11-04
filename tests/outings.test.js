import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {MongoMemoryReplSet} from 'mongodb-memory-server-core';
import {createApi} from '../server/api.js';
import {newBill,newRideBill,calculate,validateBill} from '../shared/calculations.js';
import {summarizeOuting} from '../shared/outings.js';
import {repeatBill} from '../src/repeat-bill.js';
import {draftSnapshot} from '../src/drafts.js';

test('outing totals separate unpublished drafts, partial repayments and pending confirmations',()=>{
  const dinner={...newBill('ali'),id:'dinner',outingId:'trip',status:'published',participants:['ali','sara'],items:[{id:'meal',name:'Meal',quantity:2,unitPriceCents:10000,allocations:[{personId:'ali',quantity:1},{personId:'sara',quantity:1}]}]};
  const ride={...newRideBill('sara'),id:'ride',outingId:'trip',status:'published',participants:['ali','sara'],fareCents:6000};
  const bills=[dinner,ride,{...dinner,id:'draft',status:'draft'},{...dinner,id:'elsewhere',outingId:'other'}];
  const debts=[{id:'one',bill_id:'dinner',debtor_id:'sara',creditor_id:'ali',amount:10000,paid_amount:2000,pending_amount:3000,status:'marked_paid'},{id:'two',bill_id:'ride',debtor_id:'ali',creditor_id:'sara',amount:3000,status:'assigned'},{id:'other',bill_id:'elsewhere',debtor_id:'ali',creditor_id:'sara',amount:900000,status:'assigned'}];
  const s=summarizeOuting('trip',bills,debts);
  assert.equal(s.total,26000);assert.equal(s.drafts,1);assert.equal(s.unpaid,8000);assert.equal(s.pending,3000);assert.equal(s.settled,false);
  assert.deepEqual(s.people.ali,{paid:20000,share:13000,owe:3000,owed:5000,pendingOut:0,pendingIn:3000});
  assert.equal(s.people.sara.paid,6000);assert.equal(s.people.sara.share,13000);
  assert.equal(summarizeOuting('empty',bills,debts).settled,false);
  assert.equal(summarizeOuting('trip',bills,debts.map(d=>({...d,paid_amount:d.amount,pending_amount:0,status:'confirmed'}))).settled,true);
});

test('repeat creates independent editable food and ride drafts without old receipt or payment metadata',()=>{
  const source={...newBill('ali'),id:'original',version:8,status:'published',creatorId:'ali',title:'Dinner',date:'2020-01-01',outingId:'old-outing',receiptId:'old-photo',receiptTotalCents:31000,adjustmentCents:1000,adjustmentReason:'Old rounding',participants:['ali','sara'],payments:[{personId:'ali',amountCents:20000},{personId:'sara',amountCents:11000}],items:[{id:'old-item',name:'Dinner',quantity:2,unitPriceCents:15000,allocations:[{personId:'ali',quantity:1},{personId:'sara',quantity:1}]}],photo:'SECRET',repayments:['SECRET'],_localDraftId:'old-draft'};
  const copy=repeatBill(source);
  assert.equal(copy.id,undefined);assert.equal(copy.version,undefined);assert.equal(copy.status,undefined);assert.equal(copy.creatorId,undefined);assert.notEqual(copy._localDraftId,source._localDraftId);
  assert.equal(copy.date,newBill('ali').date);assert.equal(copy.outingId,null);assert.equal(copy.receiptTotalCents,null);assert.equal(copy.receiptId,null);assert.equal(copy.adjustmentCents,0);assert.equal(copy.adjustmentReason,'');assert.equal(copy.entryMode,'manual');assert.ok(!JSON.stringify(copy).includes('SECRET'));
  assert.notEqual(copy.items[0].id,source.items[0].id);assert.deepEqual(copy.items[0].allocations,source.items[0].allocations);assert.deepEqual(copy.payments,source.payments);
  copy.items[0].allocations[0].quantity=0;assert.equal(source.items[0].allocations[0].quantity,1);
  const ride={...newRideBill('ali'),title:'Ride',fareCents:10001,participants:['ali','sara'],id:'old-ride',outingId:'old'};
  const next=repeatBill(ride);assert.equal(calculate(next).total,10001);assert.equal(next.id,undefined);assert.equal(next.outingId,null);assert.equal(next.date,newBill('ali').date);
  assert.equal(draftSnapshot({...copy,outingId:'new-trip'}).outingId,'new-trip');assert.equal(validateBill({...source,outingId:'trip'}).outingId,'trip');assert.throws(()=>validateBill({...source,outingId:{$ne:null}}),/outing/);
});

test('outings enforce membership, draft privacy, bill ownership and durable repayment history',async t=>{
  const replica=await MongoMemoryReplSet.create({replSet:{count:1}});
  const {api,db}=await createApi(undefined,{uri:replica.getUri(),databaseName:'outing_test',mail:{enabled:false}}),app=express();app.use('/api',api);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await db.close();await replica.stop();});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  async function call(path,token,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
  const ali=(await call('/register',null,{name:'Ali',username:'outing_ali'})).data;
  const stranger=(await call('/register',null,{name:'Stranger',username:'outing_stranger'})).data;
  const invitation=(await call('/friends',ali.token,{name:'Sara'})).data;
  const sara=(await call('/register',null,{name:'Sara',username:'outing_sara',inviteToken:invitation.inviteToken})).data;
  const hamzaInvite=(await call('/friends',ali.token,{name:'Hamza'})).data;
  const hamza=(await call('/register',null,{name:'Hamza',username:'outing_hamza',inviteToken:hamzaInvite.inviteToken})).data;
  await call('/profile',ali.token,{name:'Ali',paymentDetails:'TEST account'},'PATCH');
  const members=[ali.user.id,sara.user.id,hamza.user.id];
  assert.equal((await call('/outings',null,{title:'No access',members})).status,401);
  assert.equal((await call('/outings',ali.token,{title:'Bad',members:[ali.user.id,stranger.user.id]})).status,403);
  assert.equal((await call('/outings',ali.token,{title:'Bad',members:[ali.user.id,ali.user.id]})).status,400);
  let outing=(await call('/outings',ali.token,{title:'Saturday night',members})).data;
  assert.equal((await call('/state',stranger.token)).data.outings.length,0);
  assert.equal((await call('/state',hamza.token)).data.outings[0].title,'Saturday night');
  assert.equal((await call(`/outings/${outing.id}`,sara.token,{title:'Not owner',version:1},'PATCH')).status,409);
  assert.equal((await call(`/outings/${outing.id}`,ali.token,{title:'Invalid version',version:{$ne:0}},'PATCH')).status,409);
  outing=(await call(`/outings/${outing.id}`,ali.token,{title:'Saturday outing',version:1},'PATCH')).data;
  assert.equal(outing.version,2);
  const bill={...newRideBill(ali.user.id),outingId:outing.id,participants:[ali.user.id,sara.user.id],fareCents:10000};
  const draft=(await call('/bills',ali.token,{bill})).data;
  assert.equal((await call('/state',hamza.token)).data.bills.length,0,'other outing members never see drafts');
  assert.equal((await call('/state',sara.token)).data.bills.length,0,'even participants cannot see drafts');
  assert.equal((await call(`/bills/${draft.id}/publish`,ali.token,{version:1})).status,200);
  const hs=(await call('/state',hamza.token)).data;
  assert.equal(hs.bills.length,1,'outing member sees published bill they did not split');assert.equal(hs.debts.length,1);assert.equal(hs.bills[0].outingId,outing.id);
  assert.equal((await call('/state',stranger.token)).data.bills.length,0);
  const debt=hs.debts[0];
  assert.equal((await call('/repayments',hamza.token,{debtIds:[debt.id],amountCents:1000,requestId:'outsider-report'})).status,403);
  const report=(await call('/repayments',sara.token,{debtIds:[debt.id],amountCents:1000,requestId:'outing-report-one'})).data;
  assert.equal((await call(`/repayments/${encodeURIComponent(report.id)}/action`,hamza.token,{action:'confirm'})).status,403);
  const before=await db.one('debts',{id:debt.id});
  assert.equal((await call(`/bills/${draft.id}/outing`,sara.token,{outingId:null,version:2},'PATCH')).status,403);
  assert.equal((await call(`/bills/${draft.id}/outing`,ali.token,{outingId:null,version:99},'PATCH')).status,409);
  const detached=(await call(`/bills/${draft.id}/outing`,ali.token,{outingId:null,version:2},'PATCH')).data;
  assert.equal(detached.outingId,null);assert.deepEqual(await db.one('debts',{id:debt.id}),before);assert.deepEqual(await db.one('repayments',{id:report.id}),report);
  assert.equal((await call('/state',hamza.token)).data.bills.length,0,'removing outing does not retain access for nonparticipants');
  assert.equal((await call('/state',sara.token)).data.bills.length,1,'bill participant keeps access');
  await call(`/bills/${draft.id}/outing`,ali.token,{outingId:outing.id,version:detached.version},'PATCH');
  const privateOuting=(await call('/outings',stranger.token,{title:'Private',members:[stranger.user.id]})).data;
  assert.equal((await call('/bills',ali.token,{bill:{...bill,outingId:privateOuting.id}})).status,403);
  assert.equal((await call('/bills',stranger.token,{bill:{...newRideBill(stranger.user.id),outingId:outing.id,fareCents:100}})).status,403);
  const small=(await call('/outings',ali.token,{title:'Solo',members:[ali.user.id]})).data;
  assert.equal((await call('/bills',ali.token,{bill:{...bill,outingId:small.id}})).status,400,'all bill participants must be outing members');
  const saraDraft=await call('/bills',sara.token,{bill:{...newRideBill(sara.user.id),title:'Sara ride',participants:[sara.user.id,hamza.user.id],outingId:outing.id,fareCents:1000}});
  assert.equal(saraDraft.status,201,'members can add bills with other outing members');
  // Repeating only saves a new draft and never changes the original debt/history.
  const copied=await call('/bills',ali.token,{bill:repeatBill(detached)});assert.equal(copied.status,201);assert.notEqual(copied.data.id,draft.id);assert.equal(copied.data.status,'draft');assert.equal(copied.data.outingId,null);assert.equal((await db.many('debts')).length,1);
  // An invitation claimed by an existing account updates outing membership too.
  const invite=(await call('/friends',ali.token,{name:'Invited friend'})).data;
  const group=(await call('/outings',ali.token,{title:'Next trip',members:[ali.user.id,invite.person.id]})).data;
  await call(`/invite/${invite.inviteToken}/claim`,stranger.token,{});
  assert.deepEqual((await db.one('outings',{id:group.id})).members,[ali.user.id,stranger.user.id]);
  assert.equal((await call('/state',stranger.token)).data.outings.some(o=>o.id===group.id),true);
});
