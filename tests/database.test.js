import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { migrateLegacy } from '../server/migrate-legacy.js';
import { billWithTax as newBill } from './helpers/bills.js';
import { openDatabase } from '../server/database.js';
import { MongoClient } from 'mongodb';

test('runtime refuses missing or malformed MongoDB credentials', async () => {
  await assert.rejects(openDatabase(undefined,{uri:''}),/Persistent database missing/);
  await assert.rejects(openDatabase(undefined,{uri:'https://wrong'}),/MongoDB connection string/);
});
test('MongoDB transactions roll back and usernames are unique at database level', async () => {
  const replica=await MongoMemoryReplSet.create({replSet:{count:1}});
  let db, migrationDb;
  try {
    db=await openDatabase(undefined,{uri:replica.getUri(),databaseName:'database_test'});
    await assert.rejects(db.transaction(async()=>{
      await db.insert('users',{id:'rollback',name:'Test'});
      await db.insert('events',{id:'rollback_event',user_id:'rollback'});
      throw Error('Simulated failure');
    }),/Simulated failure/);
    assert.equal(await db.one('users',{id:'rollback'}),null);
    assert.equal(await db.one('events',{id:'rollback_event'}),null);
    await db.insert('users',{id:'one',username:'same_name'});
    await assert.rejects(db.insert('users',{id:'two',username:'same_name'}),e=>e.code===11000);
    await db.insert('users',{id:'invite-one'});
    await db.insert('users',{id:'invite-two'});
    const rates=await Promise.all(Array.from({length:10},()=>db.rateLimit('test-ip-hash')));
    assert.equal(Math.max(...rates.map(r=>r.count)),10);
    migrationDb=await openDatabase(undefined,{uri:replica.getUri(),databaseName:'migration_test'});
    const legacy={users:[{id:'legacy-user',name:'Old name',claimed:1,recovery_hash:'recovery-hash',payment_details:'Test details'}],sessions:[{token_hash:'session-hash',user_id:'legacy-user'}],contacts:[],invitations:[],bills:[{id:'legacy-bill',creator_id:'legacy-user',status:'draft',version:1,data:JSON.stringify({...newBill('legacy-user'),receiptId:'old-photo'})}],debts:[],events:[{id:'legacy-event',user_id:'legacy-user',is_read:0}]};
    const original=JSON.stringify(legacy);
    const source={prepare:sql=>({all:()=>structuredClone(legacy[sql.split(' ').at(-1)])})};
    const insertMany=migrationDb.insertMany;
    migrationDb.insertMany=(table,rows)=>{if(table==='events')throw Error('Simulated migration failure');return insertMany(table,rows);};
    await assert.rejects(migrateLegacy(source,migrationDb),/Simulated migration failure/);
    assert.equal((await migrationDb.many('users')).length,0,'failed migration rolls back copied profiles');
    migrationDb.insertMany=insertMany;
    assert.equal((await migrateLegacy(source,migrationDb)).users,1);
    assert.equal((await migrationDb.one('users',{id:'legacy-user'})).username,'user_legacyuser');
    assert.equal((await migrationDb.one('sessions',{id:'session-hash'})).user_id,'legacy-user');
    assert.equal((await migrationDb.one('bills',{id:'legacy-bill'})).data.receiptId,null);
    assert.equal(JSON.stringify(legacy),original,'source data is untouched');
    await assert.rejects(migrateLegacy(source,migrationDb),/empty destination/);
  } finally {if(db)await db.close();if(migrationDb)await migrationDb.close();await replica.stop();}
});
test('legacy debt index migrates without changing existing payments', async () => {
  const replica=await MongoMemoryReplSet.create({replSet:{count:1}});
  const client=new MongoClient(replica.getUri()); let db;
  try {
    await client.connect(); const debts=client.db('index_test').collection('debts');
    await debts.createIndex({bill_id:1,debtor_id:1},{unique:true});
    const old={id:'old',bill_id:'bill',debtor_id:'a',creditor_id:'b',amount:100,status:'confirmed'};
    await debts.insertOne({...old});
    db=await openDatabase(null,{uri:replica.getUri(),databaseName:'index_test'});
    assert.deepEqual(await db.one('debts',{id:'old'}),old);
    await db.insert('debts',{...old,id:'new',creditor_id:'c',status:'assigned'});
    await assert.rejects(db.insert('debts',{...old,id:'duplicate'}),e=>e.code===11000);
  } finally { if(db) await db.close(); await client.close(); await replica.stop(); }
});
