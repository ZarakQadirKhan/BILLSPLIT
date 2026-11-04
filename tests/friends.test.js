import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { createApi } from '../server/api.js';
import { newBill } from '../shared/calculations.js';

test('in-app friend requests require consent, keep directory private and allow repayments without account details', async t => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const { api, db } = await createApi(undefined, { uri: replica.getUri(), databaseName: 'friends_test', mail: { enabled: false } });
  const app = express(); app.use('/api', api);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => server.close(r)); await db.close(); await replica.stop(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(path, token, body) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  const ali = (await call('/register', null, { name: 'Ali', username: 'ali' })).data;
  const sara = (await call('/register', null, { name: 'Sara', username: 'sara' })).data;
  const outsider = (await call('/register', null, { name: 'Outsider', username: 'outsider' })).data;
  await db.update('users', { id: sara.user.id }, { $set: { email: 'private@example.test', payment_details: 'SECRET ACCOUNT' } });
  const old = (await call('/friends', ali.token, { name: 'Old invitation' })).data;
  assert.equal((await call('/people')).status, 401);
  const directory = (await call('/people', ali.token)).data.people;
  assert.equal(directory.length, 2, 'all other joined people listed, no placeholders');
  assert.deepEqual(Object.keys(directory[0]).sort(), ['id', 'name', 'relationship', 'username']);
  assert.ok(!JSON.stringify(directory).includes('SECRET'));
  assert.equal((await call('/friend-requests', ali.token, { personId: ali.user.id })).status, 400);
  assert.equal((await call('/friend-requests', ali.token, { personId: { $ne: null } })).status, 400);
  assert.equal((await call('/friend-requests', ali.token, { personId: old.person.id })).status, 404);
  const sent = await Promise.all([call('/friend-requests', ali.token, { personId: sara.user.id }), call('/friend-requests', ali.token, { personId: sara.user.id })]);
  assert.deepEqual(sent.map(r => r.status), [200, 200]);
  const row = sent[0].data;
  assert.equal((await db.many('friend_requests', {})).length, 1);
  assert.equal((await db.many('events', { friend_request_id: row.id })).length, 1);
  assert.equal((await call('/friend-requests', sara.token, { personId: ali.user.id })).status, 409);
  const pendingState = (await call('/state', sara.token)).data;
  assert.equal(pendingState.friendRequests[0].sender.name, 'Ali');
  assert.equal(pendingState.people.length, 1, 'pending requests do not expose profiles or bill access');
  assert.equal((await call('/state', outsider.token)).data.friendRequests.length, 0);
  assert.equal((await call(`/friend-requests/${row.id}/action`, ali.token, { action: 'accept', version: row.version })).status, 403);
  assert.equal((await call(`/friend-requests/${row.id}/action`, outsider.token, { action: 'accept', version: row.version })).status, 403);
  assert.equal((await call(`/friend-requests/${row.id}/action`, sara.token, { action: 'cancel', version: row.version })).status, 403);
  assert.equal((await call(`/friend-requests/${row.id}/action`, sara.token, { action: 'accept', version: { $ne: 0 } })).status, 400);
  const accepted = await Promise.all([call(`/friend-requests/${row.id}/action`, sara.token, { action: 'accept', version: row.version }), call(`/friend-requests/${row.id}/action`, sara.token, { action: 'accept', version: row.version })]);
  assert.deepEqual(accepted.map(r => r.status).sort(), [200, 409]);
  assert.equal((await db.many('contacts', { owner_id: sara.user.id })).length, 1);
  assert.equal((await call('/state', ali.token)).data.friendRequests.length, 0);
  assert.equal((await call('/people', ali.token)).data.people.find(p => p.id === sara.user.id).relationship, 'friends');
  assert.equal((await call('/friend-requests', ali.token, { personId: sara.user.id })).status, 409);
  // The receiver has joined but has neither payment details nor verified email.
  const bill = { ...newBill(ali.user.id), title: 'Dinner', participants: [ali.user.id, sara.user.id], items: [{ id: 'dinner', name: 'Dinner', quantity: 2, unitPriceCents: 10000, allocations: [{ personId: ali.user.id, quantity: 1 }, { personId: sara.user.id, quantity: 1 }] }], receiptReview: { options: [], selectedOption: null, needsTotal: true } };
  const saved = (await call('/bills', ali.token, { bill })).data;
  assert.equal((await call(`/bills/${saved.id}/publish`, ali.token, { version: saved.version })).status, 200);
  assert.equal((await call('/state', sara.token)).data.debts[0].amount, 10000);
  const unjoined = { ...bill, paidBy: old.person.id, participants: [ali.user.id, old.person.id], items: [{ ...bill.items[0], allocations: [{ personId: ali.user.id, quantity: 2 }] }] };
  const draft = (await call('/bills', ali.token, { bill: unjoined })).data;
  assert.equal((await call(`/bills/${draft.id}/publish`, ali.token, { version: draft.version })).status, 400, 'unjoined recipients still cannot receive repayments');
  // Decline/cancel are reversible by a fresh request; stale actions never accept it.
  let pending = (await call('/friend-requests', outsider.token, { personId: ali.user.id })).data;
  assert.equal((await call(`/friend-requests/${pending.id}/action`, ali.token, { action: 'decline', version: pending.version })).status, 200);
  const staleVersion = pending.version;
  pending = (await call('/friend-requests', outsider.token, { personId: ali.user.id })).data;
  assert.equal((await call(`/friend-requests/${pending.id}/action`, ali.token, { action: 'accept', version: staleVersion })).status, 409);
  assert.equal((await call(`/friend-requests/${pending.id}/action`, outsider.token, { action: 'cancel', version: pending.version })).status, 200);
  assert.equal((await call('/state', ali.token)).data.friendRequests.length, 0);
});
