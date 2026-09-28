import { AsyncLocalStorage } from 'node:async_hooks';
import { MongoClient } from 'mongodb';

export const collections = ['users', 'sessions', 'contacts', 'invitations', 'bills', 'debts', 'events', 'rate_limits', 'email_outbox', 'ai_budget', 'ai_usage'];

export async function openDatabase(_directory, options = {}) {
  const uri = options.uri ?? process.env.MONGODB_URI;
  if (!uri) throw Error('Persistent database missing: set MONGODB_URI in your private environment settings.');
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) throw Error('MONGODB_URI must be a MongoDB connection string.');
  const client = new MongoClient(uri, { maxPoolSize: 5, minPoolSize: 0, maxIdleTimeMS: 60000, serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const mongo = client.db(options.databaseName ?? process.env.MONGODB_DB ?? 'tab_together');
    for (const name of collections) await mongo.collection(name).createIndex({ id: 1 }, { unique: true });
    await mongo.collection('users').createIndex({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } });
    await mongo.collection('users').createIndex({ recovery_hash: 1 }, { unique: true, partialFilterExpression: { recovery_hash: { $type: 'string' } } });
    await mongo.collection('contacts').createIndex({ owner_id: 1, person_id: 1 }, { unique: true });
    await mongo.collection('invitations').createIndex({ person_id: 1 }, { unique: true });
    await mongo.collection('bills').createIndex({ creator_id: 1, created_at: -1 });
    await mongo.collection('bills').createIndex({ participants: 1, status: 1 });
    await mongo.collection('debts').createIndex({ bill_id: 1, debtor_id: 1 }, { unique: true });
    await mongo.collection('debts').createIndex({ creditor_id: 1, status: 1 });
    await mongo.collection('debts').createIndex({ debtor_id: 1, status: 1 });
    await mongo.collection('events').createIndex({ user_id: 1, created_at: -1 });
    await mongo.collection('rate_limits').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
    await mongo.collection('email_outbox').createIndex({ status: 1, retry_at: 1, lease_until: 1 });
    await mongo.collection('email_outbox').createIndex({ user_id: 1, status: 1 });
    await mongo.collection('email_outbox').createIndex({ delete_after: 1 }, { expireAfterSeconds: 0 });
    await mongo.collection('mail_control').updateOne({ _id: 'budget' }, { $setOnInsert: { attempts: [] } }, { upsert: true });

    const context = new AsyncLocalStorage();
    const settings = extra => ({ ...extra, ...(context.getStore() ? { session: context.getStore() } : {}) });
    return {
      kind: 'mongodb',
      one: (name, filter) => mongo.collection(name).findOne(filter, settings({ projection: { _id: 0 } })),
      many: (name, filter = {}, extra = {}) => mongo.collection(name).find(filter, settings({ projection: { _id: 0 }, ...extra })).toArray(),
      insert: (name, doc) => mongo.collection(name).insertOne({ ...doc }, settings()),
      insertMany: (name, docs) => mongo.collection(name).insertMany(docs.map(doc => ({ ...doc })), settings()),
      update: (name, filter, update, extra) => mongo.collection(name).updateOne(filter, update, settings(extra)),
      updateMany: (name, filter, update) => mongo.collection(name).updateMany(filter, update, settings()),
      remove: (name, filter) => mongo.collection(name).deleteMany(filter, settings()),
      async reserveScanBudget(id, reservedNano, limitNano) {
        if (!Number.isSafeInteger(reservedNano) || reservedNano <= 0 || !Number.isSafeInteger(limitNano) || limitNano < reservedNano) return false;
        try {
          await this.update('ai_budget', { id: 'openai-lifetime' }, { $setOnInsert: { chargedNano: 0 } }, { upsert: true });
        } catch (error) { if (error.code !== 11000) throw error; }
        return this.transaction(async () => {
          const changed = await this.update('ai_budget', { id: 'openai-lifetime', chargedNano: { $lte: limitNano - reservedNano } }, { $inc: { chargedNano: reservedNano } });
          if (!changed.modifiedCount) return false;
          await this.insert('ai_usage', { id, reservedNano, status: 'reserved', createdAt: new Date() });
          return true;
        });
      },
      async settleScanBudget(id, chargedNano, usage) {
        if (!Number.isSafeInteger(chargedNano) || chargedNano < 0) throw Error('Invalid scan cost');
        return this.transaction(async () => {
          const row = await this.one('ai_usage', { id, status: 'reserved' });
          if (!row) return;
          await this.update('ai_usage', { id, status: 'reserved' }, { $set: { status: 'settled', chargedNano, usage } });
          await this.update('ai_budget', { id: 'openai-lifetime' }, { $inc: { chargedNano: chargedNano - row.reservedNano } });
        });
      },
      claimEmail: () => mongo.collection('email_outbox').findOneAndUpdate({ $or: [{ status: 'pending', retry_at: { $lte: new Date() } }, { status: 'sending', lease_until: { $lt: new Date() } }] }, { $set: { status: 'sending', lease_until: new Date(Date.now() + 60000) }, $inc: { attempts: 1 } }, { returnDocument: 'after', sort: { created_at: 1 }, projection: { _id: 0 } }),
      async reserveEmailAttempt(limit) {
        const cutoff = new Date(Date.now() - 86400000);
        const row = await mongo.collection('mail_control').findOneAndUpdate({ _id: 'budget' }, [
          { $set: { attempts: { $filter: { input: '$attempts', as: 'time', cond: { $gt: ['$$time', cutoff] } } } } },
          { $set: { permitted: { $lt: [{ $size: '$attempts' }, limit] } } },
          { $set: { attempts: { $cond: ['$permitted', { $concatArrays: ['$attempts', [new Date()]] }, '$attempts'] } } },
        ], { returnDocument: 'after' });
        return row.permitted;
      },
      async rateLimit(key, windowMs = 60000) {
        const time = Date.now(), id = key + ':' + Math.floor(time / windowMs);
        // Fixed windows (one minute by default) with TTL cleanup; never store raw IP addresses.
        try {
          return await mongo.collection('rate_limits').findOneAndUpdate({ id }, { $inc: { count: 1 }, $setOnInsert: { expires_at: new Date(time + 2 * windowMs) } }, { upsert: true, returnDocument: 'after' });
        } catch (error) {
          if (error.code !== 11000) throw error;
          return mongo.collection('rate_limits').findOneAndUpdate({ id }, { $inc: { count: 1 } }, { returnDocument: 'after' });
        }
      },
      async transaction(fn) {
        if (context.getStore()) return fn();
        const session = client.startSession();
        try {
          return await session.withTransaction(() => context.run(session, fn), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', timeoutMS: 15000 });
        } finally { await session.endSession(); }
      },
      health: () => mongo.command({ ping: 1 }),
      close: () => client.close(),
    };
  } catch (error) { await client.close(); throw error; }
}
