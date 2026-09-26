import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createClient } from '@libsql/client';
import { openDatabase } from '../server/database.js';

test('cloud runtime refuses a temporary/local database when credentials are missing', async () => {
  await assert.rejects(openDatabase(undefined,{url:'',requireRemote:true}),/Persistent database missing/);
});
for(const backend of ['sqlite','libsql']) test(`${backend}: failed transaction rolls back every statement`,async()=>{
  const directory=mkdtempSync(`${tmpdir()}/tab-db-test-`);
  const db=await openDatabase(directory,{url:'',requireRemote:false,...(backend==='libsql'?{client:createClient({url:`file:${directory}/test.sqlite`})}:{})});
  try {
    await assert.rejects(db.transaction(async()=>{await db.run('INSERT INTO users(id,name,created_at) VALUES(?,?,?)','rollback-test','Test',new Date().toISOString()); throw Error('Simulated failure');}),/Simulated failure/);
    assert.equal(await db.get('SELECT * FROM users WHERE id=?','rollback-test'),undefined);
  } finally {await db.close();}
});
