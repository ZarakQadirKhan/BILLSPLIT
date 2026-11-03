import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {MongoMemoryReplSet} from 'mongodb-memory-server-core';
import {createApi} from '../server/api.js';
import {reminderDay,isReminderHour,reminderQuote,queueDailyReminders} from '../server/reminders.js';
import {reminderQuotes} from '../server/reminder-quotes.js';

test('midnight uses Pakistan time and all 100 quotes substitute names and amounts safely',()=>{
  assert.equal(reminderDay(new Date('2026-11-03T19:00:00Z')),'2026-11-04');
  assert.equal(isReminderHour(new Date('2026-11-03T18:59:59Z')),false);
  assert.equal(isReminderHour(new Date('2026-11-03T19:59:59Z')),true);
  assert.equal(isReminderHour(new Date('2026-11-03T20:00:00Z')),false);
  assert.equal(reminderQuotes.length,100);
  for(let i=0;i<100;i++){
    const line=reminderQuote(i,'Sara',70000);
    assert.ok(!/\{name\}|\{amount\}|Rahul/.test(line));
    if(reminderQuotes[i].includes('{amount}'))assert.match(line,/700\.00/);
    if(reminderQuotes[i].includes('{name}'))assert.match(line,/Sara/);
  }
  assert.ok(reminderQuote(0,'$& literal',70000).startsWith('$& literal'));
});

test('reminders skip cleared/pending-only users, refresh amounts on send, deduplicate and secure cron',async t=>{
  const repl=await MongoMemoryReplSet.create({replSet:{count:1}});
  let time=new Date();time.setUTCHours(19,10,0,0);
  // Pick a recent midnight window so queued test emails are immediately due.
  if(time>new Date())time.setUTCDate(time.getUTCDate()-1);
  const sent=[],secret='test-cron-secret-0123456789-abcdef';let failSend=false;
  const {api,db,mail}=await createApi(undefined,{uri:repl.getUri(),databaseName:'reminder_test',cronSecret:secret,clock:()=>time,mail:{clock:()=>time,enabled:true,from:'sender@example.test',baseUrl:'https://example.test',transport:{async sendMail(m){if(failSend)throw Error('Test outage');sent.push(m);return {messageId:m.messageId};}}}});
  const app=express();app.use('/api',api);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await db.close();await repl.stop();});
  async function user(id,patch={}){await db.insert('users',{id,name:id==='partial'?'Sara':id,email:`${id}@example.test`,claimed:true,email_verified:true,email_notifications:true,...patch});}
  async function debt(id,userId,amount,patch={}){await db.insert('debts',{id,bill_id:id,debtor_id:userId,creditor_id:'ali',status:'assigned',amount,...patch});}
  await user('ali');for(const name of ['partial','cleared','pending','unverified','optout','legacy','settles','changes','retry','expires'])await user(name);
  await db.update('users',{id:'unverified'},{$set:{email_verified:false}});await db.update('users',{id:'optout'},{$set:{email_notifications:false}});
  await debt('p1','partial',120000,{paid_amount:20000,pending_amount:30000,status:'marked_paid'});await debt('p2','partial',10000);
  await debt('c1','cleared',120000,{paid_amount:120000,pending_amount:0,status:'confirmed'});
  await debt('c2','cleared',10000,{status:'confirmed'});
  await debt('n1','pending',120000,{paid_amount:20000,pending_amount:100000,status:'marked_paid'});
  await debt('legacy','legacy',10000,{status:'marked_paid'});
  for(const name of ['unverified','optout','settles','changes','retry','expires'])await debt(name,name,120000);
  assert.equal((await queueDailyReminders(db,{now:new Date('2026-11-03T18:59:59Z')})).skipped,true);
  const queued=await Promise.all([queueDailyReminders(db,{now:time,choose:()=>11}),queueDailyReminders(db,{now:time,choose:()=>11})]);
  assert.equal(queued.reduce((s,x)=>s+x.queued,0),5);
  assert.equal((await db.many('email_outbox',{kind:'reminder'})).length,5);
  for(const id of ['cleared','pending','legacy','optout','unverified','ali'])assert.equal((await db.many('email_outbox',{user_id:id})).length,0);
  await db.update('debts',{id:'settles'},{$set:{status:'confirmed',paid_amount:120000}});
  await db.update('debts',{id:'changes'},{$set:{status:'marked_paid',paid_amount:20000,pending_amount:50000}});
  // Hold two records to separately exercise failed delivery and next-day expiry.
  for(const id of ['retry','expires'])await db.update('email_outbox',{user_id:id},{$set:{retry_at:new Date(Date.now()+86400000)}});
  await mail.flush();
  assert.equal(sent.length,2);assert.ok(!sent.some(m=>m.to==='settles@example.test'));
  const partial=sent.find(m=>m.to==='partial@example.test');assert.match(partial.text,/Hi Sara/);assert.match(partial.text,/800\.00/);assert.match(partial.text,/ali/);assert.ok(!partial.text.includes('{amount}'));assert.match(partial.subject,/Paisay dou \$/);
  assert.match(sent.find(m=>m.to==='changes@example.test').text,/500\.00/);
  assert.equal((await db.one('email_outbox',{user_id:'settles'})).status,'canceled');
  await db.update('email_outbox',{user_id:'retry'},{$set:{retry_at:new Date(0)}});failSend=true;await mail.flush();failSend=false;
  await db.update('debts',{id:'retry'},{$set:{status:'confirmed',paid_amount:120000}});await db.update('email_outbox',{user_id:'retry'},{$set:{retry_at:new Date(0)}});await mail.flush();
  assert.equal(sent.length,2,'clearing dues after a failed attempt cancels the retry');
  time=new Date(time.getTime()+86400000);await db.update('email_outbox',{user_id:'expires'},{$set:{retry_at:new Date(0)}});await mail.flush();assert.equal(sent.length,2,'old daily reminders expire');
  const base=`http://127.0.0.1:${server.address().port}/api/cron/reminders`;
  assert.equal((await fetch(base)).status,401);assert.equal((await fetch(base,{headers:{authorization:'Bearer wrong'}})).status,401);
  assert.equal((await fetch(base,{method:'HEAD',headers:{authorization:`Bearer ${secret}`}})).status,401);
  const dry=await fetch(base+'?dryRun=1',{headers:{authorization:`Bearer ${secret}`}});assert.equal(dry.status,200);assert.equal((await dry.json()).configured,true);assert.equal(sent.length,2);
  const run=await fetch(base,{headers:{authorization:`Bearer ${secret}`}});assert.equal(run.status,200);assert.equal((await run.json()).queued,3);
  assert.equal((await db.many('email_outbox',{reminder_day:reminderDay(time)})).length,3);
  await fetch(base,{headers:{authorization:`Bearer ${secret}`}});assert.equal((await db.many('email_outbox',{reminder_day:reminderDay(time)})).length,3);
});
