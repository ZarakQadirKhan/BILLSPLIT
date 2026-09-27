import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { createApi } from '../server/api.js';
import { newBill, newRideBill, calculate } from '../shared/calculations.js';

test('MongoDB: settlement, rides, permissions, concurrent actions and durable history', async t => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const options = () => ({ uri: replica.getUri(), databaseName: 'api_test' });
  const { api, db } = await createApi(undefined, options()), app = express(); app.use('/api', api);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); await replica.stop(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(route, token, body, method = body ? 'POST' : 'GET') { const response = await fetch(`${base}${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type':'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, data: await response.json() }; }
  const ali = (await call('/register', null, { name: 'Ali', username: 'Ali_123' })).data, stranger = (await call('/register', null, { name: 'Stranger', username: 'stranger' })).data;
  assert.equal((await call('/state')).status, 401);
  const friend = (await call('/friends', ali.token, { name: 'Sara' })).data;
  await call('/profile', ali.token, { name: 'Ali', paymentDetails: 'TEST account — no real transfers' }, 'PATCH');
  let b = newBill(ali.user.id); b.title = 'Test dinner'; b.participants.push(friend.person.id); b.items = [{ id:'food', name:'Dinner', quantity:2, unitPriceCents:1500000, eligible:true, allocations:[{ personId:ali.user.id, quantity:1 }, { personId:friend.person.id, quantity:1 }] }]; b.discount = { ...b.discount, type:'percent', rate:50, eligibleCapCents:2000000 };
  let saved = (await call('/bills', ali.token, { bill:b })).data;
  assert.equal((await call('/state', stranger.token)).data.bills.length,0);
  assert.equal((await call(`/bills/${saved.id}`, stranger.token, { bill:b, version:saved.version }, 'PUT')).status,403);
  assert.equal((await call(`/bills/${saved.id}`, ali.token, { bill:b, version:999 }, 'PUT')).status,409);
  const sara = (await call('/register', null, { name:'Sara', username:'sara', inviteToken:friend.inviteToken })).data;
  assert.equal((await call('/state', sara.token)).data.bills.length,0, 'other participants cannot see drafts');
  assert.equal((await call('/register', null, { name:'Fake Sara', username:'fake_sara', inviteToken:friend.inviteToken })).status,404);
  const published = await call(`/bills/${saved.id}/publish`, ali.token, { version:saved.version }); assert.equal(published.status,200);
  assert.equal((await call(`/bills/${saved.id}/publish`, ali.token, { version:saved.version })).status,409);
  const saraState = (await call('/state', sara.token)).data, aliState = (await call('/state', ali.token)).data;
  assert.equal(saraState.bills.length,1); assert.ok(saraState.events.length); assert.equal(aliState.debts.length,1,'payer is never billed for their own share');
  const debt = saraState.debts[0]; assert.equal(debt.amount,1000000); assert.equal(debt.creditor_id,ali.user.id);
  assert.equal((await call(`/debts/${debt.id}/action`, stranger.token, { action:'accept' })).status,403);
  assert.equal((await call(`/debts/${debt.id}/action`, sara.token, { action:'confirm' })).status,403);
  assert.equal((await call(`/debts/${debt.id}/action`, sara.token, { action:'paid' })).data.status,'marked_paid');
  await call(`/debts/${debt.id}/action`, ali.token, { action:'reject', note:'Checking test transfer' });
  assert.equal((await call(`/debts/${debt.id}/action`, sara.token, { action:'dispute', note:'Check quantity' })).data.status,'disputed');
  assert.equal((await call(`/debts/${debt.id}/action`, sara.token, { action:'accept' })).data.status,'accepted');
  assert.equal((await call(`/debts/${debt.id}/action`, sara.token, { action:'paid', reference:'TEST-123' })).data.status,'marked_paid');
  assert.equal((await call('/state', ali.token)).data.debts.filter(d=>d.status!=='confirmed').reduce((s,d)=>s+d.amount,0),1000000,'marked-paid is still outstanding');
  assert.equal((await call(`/debts/${debt.id}/action`, ali.token, { action:'reject', note:'Not in test account' })).data.status,'accepted');
  await call(`/debts/${debt.id}/action`, sara.token, { action:'paid', reference:'TEST-456' });
  assert.equal((await call(`/debts/${debt.id}/action`, ali.token, { action:'confirm' })).data.status,'confirmed');
  assert.equal((await call(`/debts/${debt.id}/action`, ali.token, { action:'confirm' })).status,409,'duplicate confirmation rejected');
  assert.equal((await call(`/bills/${saved.id}`, ali.token, { bill:b, version:2 }, 'PUT')).status,409,'published bill locked');
  const recovered = (await call('/recover', null, { code:sara.recoveryCode })).data;
  assert.equal(recovered.user.id,sara.user.id); assert.equal((await call('/state', recovered.token)).data.debts[0].status,'confirmed');
  const secondDb = await createApi(undefined, options()); assert.equal((await secondDb.db.one('debts',{id:debt.id})).status,'confirmed'); await secondDb.db.close();
  // A claimed invitation can attach an existing account while keeping assignments intact.
  const invite = (await call('/friends', ali.token, { name:'Existing member' })).data;
  const another = newBill(ali.user.id); another.title='Next dinner'; another.participants.push(invite.person.id); another.items=[{ id:'pizza',name:'Pizza',quantity:1,unitPriceCents:10000,eligible:true,allocations:[{personId:invite.person.id,quantity:1}]}];
  const anotherSaved = (await call('/bills',ali.token,{bill:another})).data;
  assert.equal((await call(`/invite/${invite.inviteToken}/claim`,stranger.token,{})).status,200);
  const updated = (await call('/state',ali.token)).data.bills.find(x=>x.id===anotherSaved.id); assert.ok(updated.participants.includes(stranger.user.id)); assert.equal(calculate(updated).shares[stranger.user.id].total,10000);
  // Equal ride fare, payer exemption, tamper resistance, direct paid button flow.
  const ride = newRideBill(ali.user.id); ride.title='inDrive to home'; ride.participants=[ali.user.id,sara.user.id,stranger.user.id]; ride.fareCents=100001;
  ride.items=[{id:'tampered',name:'Unequal fare',quantity:1,unitPriceCents:1,allocations:[]}];
  const rideSaved=(await call('/bills',ali.token,{bill:ride})).data;
  assert.equal(rideSaved.items[0].name,'inDrive fare');
  assert.equal(calculate(rideSaved).shares[sara.user.id].total,33334);
  assert.equal((await call(`/bills/${rideSaved.id}/publish`,ali.token,{version:rideSaved.version})).status,200);
  const rides=(await call('/state',ali.token)).data.debts.filter(d=>d.bill_id===rideSaved.id);
  assert.equal(rides.length,2); assert.ok(rides.every(d=>d.debtor_id!==ali.user.id)); assert.equal(rides.reduce((s,d)=>s+d.amount,0),66667);
  const rideDebt=rides.find(d=>d.debtor_id===sara.user.id);
  const claims=await Promise.all([call(`/debts/${rideDebt.id}/action`,sara.token,{action:'paid'}),call(`/debts/${rideDebt.id}/action`,sara.token,{action:'paid'})]);
  assert.deepEqual(claims.map(r=>r.status).sort(),[200,409],'concurrent duplicate claims must not both succeed');
  assert.equal((await call('/state',ali.token)).data.debts.find(d=>d.id===rideDebt.id).status,'marked_paid');
  const photo=readFileSync(new URL('./fixtures/receipt.png',import.meta.url));
  const upload=await fetch(`${base}/receipts`,{method:'POST',headers:{Authorization:`Bearer ${ali.token}`,'Content-Type':'image/png'},body:photo});
  assert.equal(upload.status,410,'photos never reach MongoDB');
  assert.equal((await call('/health')).data.database,'mongodb');
  assert.equal(ali.user.username,'ali_123');
  assert.equal((await call('/register',null,{name:'Duplicate',username:'ALI_123'})).status,409);
  assert.equal((await call('/register',null,{name:'Bad',username:{$ne:null}})).status,400);
  assert.equal((await call('/register',null,{name:'Bad',username:'a b'})).status,400);
  assert.equal((await call('/profile',sara.token,{name:'Sara',username:'ALI_123',paymentDetails:''},'PATCH')).status,409);
  const sameUsername = await Promise.all([call('/register',null,{name:'One',username:'race_name'}),call('/register',null,{name:'Two',username:'RACE_NAME'})]);
  assert.deepEqual(sameUsername.map(r=>r.status).sort(),[201,409]);
  assert.equal((await call('/state',ali.token)).data.debts.find(d=>d.id===debt.id).paymentStatus,'paid');
  assert.equal((await call('/state',ali.token)).data.debts.find(d=>d.id===rideDebt.id).paymentStatus,'pending_confirmation');
  // Private fields cannot be embedded in a saved bill as client extras.
  const injected={...ride,title:'Sanitized',receiptId:'old-photo',image:'data:image/png;base64,SECRET',extra:{blob:'SECRET'}};
  injected.items[0].photo='SECRET';
  const sanitized=await call('/bills',ali.token,{bill:injected});
  assert.equal(sanitized.status,201); assert.equal(sanitized.data.receiptId,null);
  assert.ok(!JSON.stringify(await db.one('bills',{id:sanitized.data.id})).includes('SECRET'));
  // A failed invite claim (duplicate username) must roll back invitation consumption.
  const retryInvite=(await call('/friends',ali.token,{name:'Retry'})).data;
  assert.equal((await call('/register',null,{name:'Retry',username:'sara',inviteToken:retryInvite.inviteToken})).status,409);
  assert.equal((await call('/register',null,{name:'Retry',username:'retry_user',inviteToken:retryInvite.inviteToken})).status,201);


});
