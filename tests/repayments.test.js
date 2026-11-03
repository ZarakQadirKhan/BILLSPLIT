import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {MongoMemoryReplSet} from 'mongodb-memory-server-core';
import {createApi} from '../server/api.js';
import {confirmedAmount,pendingAmount,payableAmount,remainingAmount} from '../shared/payments.js';

test('partial and combined repayments are atomic, private, bounded, retry-safe and emailed accurately',async t=>{
  const replica=await MongoMemoryReplSet.create({replSet:{count:1}}),sent=[];
  const {api,db}=await createApi(undefined,{uri:replica.getUri(),databaseName:'repayments_test',mail:{enabled:true,from:'sender@example.test',baseUrl:'https://example.test',transport:{async sendMail(m){sent.push(m);return {messageId:m.messageId};}}}});
  const app=express();app.use('/api',api);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await db.close();await replica.stop();});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  async function call(path,token,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
  const alice=(await call('/register',null,{name:'Alice',username:'alice'})).data;
  const bob=(await call('/register',null,{name:'Bob',username:'bob'})).data;
  const eve=(await call('/register',null,{name:'Eve',username:'eve'})).data;
  // Synthetic verified users and bills, in an isolated test database only.
  for(const [u,email] of [[alice,'alice@example.test'],[bob,'bob@example.test']]) await db.update('users',{id:u.user.id},{$set:{email,email_verified:true,email_notifications:true}});
  async function debt(id,amount,creditor=bob.user.id,extra={}) {
    await db.insert('bills',{id:`bill-${id}`,title:`Meal ${id}`,participants:[alice.user.id,creditor],creator_id:creditor,status:'published',data:{title:`Meal ${id}`}});
    await db.insert('debts',{id,bill_id:`bill-${id}`,debtor_id:alice.user.id,creditor_id:creditor,amount,status:'assigned',...extra});
    return id;
  }
  const read=id=>db.one('debts',{id});
  const report=(ids,amount,key,token=alice.token)=>call('/repayments',token,{debtIds:ids,amountCents:amount,requestId:key,reference:'TEST transfer'});
  const decide=(p,action='confirm',token=bob.token)=>call(`/repayments/${encodeURIComponent(p.id)}/action`,token,{action,note:'Test decision'});
  await debt('first',120000);
  assert.equal((await report(['first'],50000,'unauthorised',eve.token)).status,403);
  for(const invalid of [0,-1,1.5,NaN])assert.equal((await report(['first'],invalid,'invalid-key')).status,400);
  assert.equal((await report(['first'],120001,'overpayment')).status,409);
  const first=await report(['first'],50000,'first-payment');assert.equal(first.status,201);const p=first.data;
  assert.equal(pendingAmount(await read('first')),50000);assert.equal(payableAmount(await read('first')),70000);assert.equal(remainingAmount(await read('first')),120000);
  const emailCount=sent.length;
  assert.equal((await report(['first'],50000,'first-payment')).data.id,p.id);assert.equal(sent.length,emailCount);
  assert.equal((await report(['first'],40000,'first-payment')).status,409);
  assert.equal((await decide(p,'confirm',alice.token)).status,403);
  assert.equal((await decide(p,'confirm',eve.token)).status,403);
  assert.equal((await decide(p)).status,200);
  assert.equal(confirmedAmount(await read('first')),50000);assert.equal(payableAmount(await read('first')),70000);assert.equal((await read('first')).status,'accepted');
  assert.equal((await decide(p)).status,409);
  assert.deepEqual(sent.slice(-2).map(m=>m.to).sort(),['alice@example.test','bob@example.test']);
  assert.ok(sent.slice(-2).every(m=>/500\.00/.test(m.text)&&/700\.00/.test(m.text)),'confirmation explains this amount and remaining balance');
  const second=(await report(['first'],20000,'second-payment')).data;
  const third=(await report(['first'],50000,'third-payment')).data;
  assert.equal(payableAmount(await read('first')),0);assert.equal((await report(['first'],1,'extra-payment')).status,409);
  await decide(second,'reject');assert.equal(payableAmount(await read('first')),20000);assert.equal(pendingAmount(await read('first')),50000);
  await decide(third);assert.equal(confirmedAmount(await read('first')),100000);assert.equal(remainingAmount(await read('first')),20000);
  const final=(await report(['first'],20000,'final-payment')).data;await decide(final);assert.equal((await read('first')).status,'confirmed');
  await debt('a',40000);await debt('b',60000);await debt('other',10000,eve.user.id);
  assert.equal((await report(['a','other'],20000,'mixed-creditors')).status,400);assert.equal(pendingAmount(await read('a')),0);
  assert.equal((await report(['a','a'],10000,'duplicate-debts')).status,400);
  const combined=(await report(['a','b'],70000,'combined-payment')).data;
  assert.deepEqual(combined.allocations.map(a=>a.amount),[40000,30000]);
  assert.equal((await call('/debts/a/action',bob.token,{action:'confirm'})).status,409,'old client cannot silently approve a multi-bill transfer');
  await decide(combined,'reject');assert.equal(payableAmount(await read('a')),40000);assert.equal(payableAmount(await read('b')),60000);
  const retry=(await report(['a','b'],70000,'combined-retry')).data;await decide(retry);
  assert.equal((await read('a')).status,'confirmed');assert.equal(payableAmount(await read('b')),30000);
  assert.equal(sent.at(-1).to,'bob@example.test');assert.match(sent.at(-1).text,/Meal a/);assert.match(sent.at(-1).text,/Meal b/);
  const concurrent=await Promise.all([report(['b'],30000,'concurrent-one'),report(['b'],30000,'concurrent-two')]);
  assert.deepEqual(concurrent.map(x=>x.status).sort(),[201,409]);assert.equal(pendingAmount(await read('b')),30000);
  const approvals=await Promise.all([decide(concurrent.find(x=>x.status===201).data),decide(concurrent.find(x=>x.status===201).data)]);
  assert.deepEqual(approvals.map(x=>x.status).sort(),[200,409]);assert.equal(confirmedAmount(await read('b')),60000);
  await debt('legacy',9900,bob.user.id,{status:'marked_paid'});
  assert.equal((await call('/debts/legacy/action',bob.token,{action:'confirm'})).status,200);assert.equal(confirmedAmount(await read('legacy')),9900);
  assert.equal((await db.many('repayments',{creditor_id:eve.user.id})).length,0);
  // An unrelated user sees no repayment records.
  assert.equal((await call('/state',eve.token)).data.repayments.length,0);
});
