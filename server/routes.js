import express from 'express';
import { createHash, randomBytes, randomUUID, randomInt } from 'node:crypto';
import { calculate, validateBill, UNASSIGNED } from '../shared/calculations.js';
import { openDatabase } from './database.js';
import { normalizeUsername, normalizeEmail } from '../shared/identity.js';
import { createEmailService } from './email.js';
import { createReceiptScanner, validReceiptImage } from './receipt-scan.js';
import { createReceiptPipeline } from './openai-receipt.js';
import { createRepaymentService } from './repayments.js';
import { payableAmount } from '../shared/payments.js';
import { queueDailyReminders, validCronSecret } from './reminders.js';
import { mountFriends, pendingFriendRequests } from './friends.js';
import { readScoreboard } from './scoreboard.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const now = () => new Date().toISOString();
const fail = (message, status = 400) => { const error = Error(message); error.status = status; throw error; };
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const publicUser = row => ({ id: row.id, name: row.name, username: row.username || null, claimed: !!row.claimed, paymentDetails: row.payment_details || '' });
const billResult = row => ({ ...row.data, id: row.id, creatorId: row.creator_id, status: row.status, version: row.version, createdAt: row.created_at, publishedAt: row.published_at || null });
const debtResult = row => ({ ...row, paymentStatus: row.status === 'confirmed' ? 'paid' : row.status === 'marked_paid' ? 'pending_confirmation' : 'unpaid' });

export async function createApi(dataDirectory, options = {}) {
  const db = await openDatabase(dataDirectory, options);
  const mail = createEmailService(db, options.mail);
  const scanReceipt = createReceiptPipeline(db, createReceiptScanner(db, options.scanner), options.openaiScanner);
  // One read-only SMTP handshake per server instance. No test messages are sent.
  if (options.background && mail.enabled) options.background(mail.verifySender());
  const getUser = id => db.one('users', { id });
  const selfUser = row => ({ ...publicUser(row), email: row.email || '', emailVerified: !!row.email_verified, emailNotifications: row.email_notifications !== false, emailConfigured: mail.enabled });
  async function deliver() {
    const task = mail.flush().catch(() => { console.error('Email delivery deferred; notifications remain in the outbox.'); });
    if (options.background) options.background(task); else await task;
  }
  async function verification(user) {
    if (!mail.enabled || !user.email) return;
    if (user.email_code_sent && Date.now() - new Date(user.email_code_sent).getTime() < 60000) fail('Wait one minute before requesting another verification email.', 429);
    const code = String(randomInt(100000, 1000000)), codeHash = hash(code);
    await db.update('users', { id: user.id }, { $set: { email_code_hash: codeHash, email_code_expires: new Date(Date.now() + 900000), email_code_attempts: 0, email_code_sent: new Date() } });
    await mail.queueVerification(user, code, codeHash);
  }
  const event = (user_id, bill_id, message) => db.insert('events', { id: randomUUID(), user_id, bill_id, message, is_read: false, created_at: now() });
  const payments = createRepaymentService(db,mail,event,{clock:options.clock});
  async function issueSession(user_id) {
    const token = secret();
    await db.insert('sessions', { id: hash(token), user_id });
    return token;
  }
  async function link(a, b) {
    if (a === b) return;
    for (const [owner_id, person_id] of [[a,b], [b,a]]) await db.update('contacts', { owner_id, person_id }, { $setOnInsert: { id: owner_id + ':' + person_id, owner_id, person_id } }, { upsert: true });
  }
  async function knownPeople(userId) {
    const contacts = await db.many('contacts', { owner_id: userId });
    const bills = await db.many('bills', { participants: userId, status: 'published' });
    const outings=await db.many('outings',{members:userId});
    return new Set([userId, ...contacts.map(row => row.person_id), ...bills.flatMap(row => row.participants),...outings.flatMap(o=>o.members)]);
  }
  async function checkOuting(outingId,userId,participants) {
    if(outingId==null)return;
    const outing=await db.one('outings',{id:outingId,members:userId});
    if(!outing)fail('This outing is not available to your profile.',403);
    if(participants.some(id=>!outing.members.includes(id)))fail('Everyone on this bill must be in the outing. Choose another outing or keep this bill separate.');
  }
  async function claim(token, existingId) {
    const invitation = await db.one('invitations', { id: hash(token) });
    if (!invitation) fail('This invitation was already used or is no longer valid.', 404);
    const placeholder = await getUser(invitation.person_id);
    if (!placeholder || placeholder.claimed) fail('This profile has already been claimed.');
    const targetId = existingId || placeholder.id;
    if (existingId && existingId !== placeholder.id) {
      for(const outing of await db.many('outings',{members:placeholder.id})) {
        await db.update('outings',{id:outing.id},{$set:{members:[...new Set(outing.members.map(id=>id===placeholder.id?existingId:id))]}});
      }
      for (const row of await db.many('bills', { participants: placeholder.id })) {
        const bill = row.data;
        if (bill.participants.includes(existingId)) fail('You already participate in a bill under another profile. Ask the bill creator to correct the invitation.');
        bill.participants = bill.participants.map(p => p === placeholder.id ? existingId : p);
        if (bill.paidBy === placeholder.id) bill.paidBy = existingId;
        for (const p of bill.payments || []) if (p.personId === placeholder.id) p.personId = existingId;
        for (const item of bill.items) for (const a of item.allocations) if (a.personId === placeholder.id) a.personId = existingId;
        await db.update('bills', { id: row.id }, { $set: { data: bill, participants: bill.participants }, $inc: { version: 1 } });
      }
      await db.updateMany('debts', { debtor_id: placeholder.id }, { $set: { debtor_id: existingId } });
      await db.updateMany('debts', { creditor_id: placeholder.id }, { $set: { creditor_id: existingId } });
      await db.updateMany('repayments', { debtor_id: placeholder.id }, { $set: { debtor_id: existingId } });
      await db.updateMany('repayments', { creditor_id: placeholder.id }, { $set: { creditor_id: existingId } });
      await db.updateMany('events', { user_id: placeholder.id }, { $set: { user_id: existingId } });
      for (const row of await db.many('contacts', { person_id: placeholder.id })) await link(row.owner_id, existingId);
      await db.remove('contacts', { $or: [{ owner_id: placeholder.id }, { person_id: placeholder.id }] });
      await db.remove('users', { id: placeholder.id });
    }
    await db.remove('invitations', { person_id: placeholder.id });
    await link(invitation.owner_id, targetId);
    return targetId;
  }

  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request rejected.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-site request rejected.' });
    next();
  });
  api.use(express.json({ limit: '1mb' }));
  api.get('/cron/reminders',async(req,res)=>{
    if(req.method!=='GET'||!validCronSecret(req.get('authorization'),options.cronSecret??process.env.CRON_SECRET))return res.status(401).json({error:'Unauthorized'});
    if(req.query.dryRun==='1')return res.json({ok:true,configured:mail.enabled,schedule:'0 19 * * *',timezone:'Asia/Karachi',dryRun:true});
    if(!mail.enabled)return res.status(503).json({error:'Email sender is not configured.'});
    const result=await queueDailyReminders(db,{now:options.clock?.()??new Date()});
    await mail.flush({limit:100});
    res.json({ok:true,...result});
  });
  api.use(async (req, res, next) => {
    const token = req.get('authorization')?.replace(/^Bearer /, '');
    if (token) {
      const session = await db.one('sessions', { id: hash(token) });
      if (session) req.user = await getUser(session.user_id);
    }
    next();
  });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Open your saved profile or use your recovery code.' });
  async function limited(req, res, next) {
    const row = await db.rateLimit(hash(req.ip || 'unknown'));
    if (row.count > 30) return res.status(429).json({ error: 'Please wait a minute before trying again.' });
    next();
  }
  api.get('/health', async (req, res) => { await db.health(); res.json({ ok: true, database: db.kind }); });
  api.get('/invite/:token', limited, async (req, res) => {
    const invite = await db.one('invitations', { id: hash(req.params.token) });
    if (!invite) fail('This invitation is no longer available.', 404);
    const person = await getUser(invite.person_id), owner = await getUser(invite.owner_id);
    res.json({ name: person.name, invitedBy: owner.name });
  });
  api.post('/register', limited, async (req, res) => {
    if (req.user) fail('This device already has a profile.');
    const name = clean(req.body?.name, 60), username = normalizeUsername(req.body?.username); if (!name) fail('Enter your name.');
    const result = await db.transaction(async () => {
      const userId = req.body.inviteToken ? await claim(clean(req.body.inviteToken, 100)) : randomUUID();
      const recoveryCode = secret();
      const fields = { name, username, claimed: true, recovery_hash: hash(recoveryCode), ...(req.body.email ? { email: normalizeEmail(req.body.email), email_verified: false, email_notifications: true } : {}) };
      if (req.body.inviteToken) await db.update('users', { id: userId }, { $set: fields });
      else await db.insert('users', { id: userId, ...fields, payment_details: '', created_at: now() });
      const user = await getUser(userId);
      await verification(user);
      return { token: await issueSession(userId), recoveryCode, user: selfUser(user) };
    });
    await deliver();
    res.status(201).json(result);
  });
  api.post('/recover', limited, async (req, res) => {
    const user = await db.one('users', { recovery_hash: hash(clean(req.body?.code, 100)), claimed: true });
    if (!user) fail('Recovery code not recognized.', 401);
    res.json({ token: await issueSession(user.id), user: selfUser(user) });
  });
  api.use(requireUser);
  mountFriends(api, db, link);
  api.post('/scan-receipt', (req, res, next) => {
    if (!['gemini', 'openai-gemini'].includes(req.get('x-receipt-consent'))) return res.status(400).json({ error: 'Choose AI scanning and confirm the privacy notice first.' });
    next();
  }, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }), async (req, res) => {
    const mime = req.get('content-type')?.split(';')[0];
    if (!validReceiptImage(req.body, mime)) return res.status(400).json({ error: 'Choose a valid JPG, PNG or WebP image under 2 MB after preparation.' });
    const result = await scanReceipt(req.body, mime, req.user.id, req.get('x-receipt-consent'));
    res.json(result);
  });
  api.post('/invite/:token/claim', async (req, res) => {
    await db.transaction(() => claim(req.params.token, req.user.id)); res.json({ ok: true });
  });
  api.get('/state', async (req, res) => {
    await deliver();
    const userId = req.user.id;
    const state = await db.transaction(async () => {
      const outings=await db.many('outings',{members:userId},{sort:{createdAt:-1}});
      const rows = await db.many('bills', { $or: [{ creator_id: userId }, { participants: userId, status: 'published' }, {'data.outingId':{$in:outings.map(o=>o.id)},status:'published'}] }, { sort: { created_at: -1 } });
      const contacts = await db.many('contacts', { owner_id: userId });
      const friendRequests = await pendingFriendRequests(db, userId);
      const visible = new Set([userId, ...contacts.map(row => row.person_id)]);
      for (const row of rows) { visible.add(row.creator_id); for (const p of row.participants) visible.add(p); }
      for(const outing of outings)for(const id of outing.members)visible.add(id);
      const people = await db.many('users', { id: { $in: [...visible] } });
      const debts = await db.many('debts', { bill_id: { $in: rows.map(row => row.id) } });
      const repayments = await db.many('repayments', { $or: [{ debtor_id: userId }, { creditor_id: userId }] }, { sort: { created_at: -1 } });
      const events = await db.many('events', { user_id: userId }, { sort: { created_at: -1 }, limit: 200 });
      const scoreboard = await readScoreboard(db, people, rows, debts, (options.clock?.() ?? new Date()).getTime());
      const emailQueue = await db.many('email_outbox', { user_id: userId, status: { $in: ['pending', 'sending', 'failed'] } }, { projection: { _id: 0, status: 1, last_error: 1 }, sort: { created_at: -1 } });
      return { user: selfUser(await getUser(userId)), people: people.map(publicUser), scoreboard, friendRequests, outings, bills: rows.map(billResult), debts: debts.map(debtResult), repayments, events, emailDelivery: { queued: emailQueue.filter(m => m.status !== 'failed').length, failed: emailQueue.filter(m => m.status === 'failed').length, issue: emailQueue.find(m => m.last_error)?.last_error?.category || null } };
    });
    res.json(state);
  });
  api.patch('/profile', async (req, res) => {
    const name = clean(req.body.name, 60); if (!name) fail('Enter a name.');
    const username = normalizeUsername(req.body.username ?? req.user.username);
    const user = await db.transaction(async () => {
      const current = await getUser(req.user.id);
      const email = req.body.email === undefined ? current.email || '' : req.body.email ? normalizeEmail(req.body.email) : '';
      const changed = email !== (current.email || '');
      const fields = { name, username, email, payment_details: clean(req.body.paymentDetails, 1000), email_notifications: typeof req.body.emailNotifications === 'boolean' ? req.body.emailNotifications : current.email_notifications !== false };
      await db.update('users', { id: current.id }, { $set: { ...fields, ...(changed ? { email_verified: false } : {}) }, ...(changed ? { $unset: { email_code_hash: '', email_code_expires: '' } } : {}) });
      const updated = await getUser(current.id);
      if (changed) await verification(updated);
      return selfUser(updated);
    });
    await deliver(); res.json(user);
  });
  api.post('/email/resend', limited, async (req, res) => {
    if (!mail.enabled) fail('The app owner must configure the Gmail sender before emails can be sent.', 503);
    await db.transaction(async () => {
      const user = await getUser(req.user.id);
      if (!user.email) fail('Save an email address in Your profile first.');
      if (user.email_verified) fail('Your email is already verified.');
      await verification(user);
    });
    await deliver(); res.json({ ok: true });
  });
  api.post('/email/verify', limited, async (req, res) => {
    const result = await db.transaction(async () => {
      const user = await getUser(req.user.id);
      if (user.email_verified) return { user: selfUser(user) };
      if (!user.email_code_hash || new Date(user.email_code_expires) <= new Date() || user.email_code_attempts >= 5) return { error: 'The code expired or was tried too many times. Request a new code.' };
      if (hash(clean(req.body?.code, 20)) !== user.email_code_hash) {
        await db.update('users', { id: user.id }, { $inc: { email_code_attempts: 1 } });
        return { error: 'Incorrect verification code.' };
      }
      await db.update('users', { id: user.id }, { $set: { email_verified: true }, $unset: { email_code_hash: '', email_code_expires: '' } });
      // Catch up on shares assigned before this person joined or verified.
      for (const debt of await db.many('debts', { debtor_id: user.id, status: { $in: ['assigned','accepted','disputed'] } })) await mail.queueDebt('owed', debt, user.id);
      for (const debt of await db.many('debts', { creditor_id: user.id, status: 'marked_paid', pending_amount: { $exists: false } })) await mail.queueDebt('approval', debt, user.id);
      for (const payment of await db.many('repayments', { creditor_id: user.id, status: 'pending' })) await mail.queueRepayment('approval', payment, user.id);
      return { user: selfUser(await getUser(user.id)) };
    });
    if (result.error) fail(result.error);
    await deliver(); res.json(result);
  });
  api.post('/email/retry', limited, async (req, res) => {
    await db.updateMany('email_outbox', { user_id: req.user.id, status: 'failed' }, { $set: { status: 'pending', attempts: 0, retry_at: new Date() } });
    await deliver(); res.json({ ok: true });
  });
  api.post('/recovery-code', async (req, res) => {
    const recoveryCode = secret(); await db.update('users', { id: req.user.id }, { $set: { recovery_hash: hash(recoveryCode) } }); res.json({ recoveryCode });
  });
  api.post('/friends', async (req, res) => {
    const name = clean(req.body.name, 60); if (!name) fail('Enter your friend’s name.');
    const result = await db.transaction(async () => {
      const personId = randomUUID(), token = secret();
      await db.insert('users', { id: personId, name, claimed: false, payment_details: '', created_at: now() });
      await link(req.user.id, personId);
      await db.insert('invitations', { id: hash(token), person_id: personId, owner_id: req.user.id });
      return { person: publicUser(await getUser(personId)), inviteToken: token };
    });
    res.status(201).json(result);
  });
  api.post('/friends/:id/invite', async (req, res) => {
    const result = await db.transaction(async () => {
      const person = await getUser(req.params.id);
      if (!person || person.claimed || !(await knownPeople(req.user.id)).has(person.id)) fail('Cannot create an invitation for this profile.', 403);
      const token = secret();
      await db.remove('invitations', { person_id: person.id });
      await db.insert('invitations', { id: hash(token), person_id: person.id, owner_id: req.user.id });
      return { inviteToken: token };
    }); res.json(result);
  });
  // Images stay in the browser. Reject upload attempts from older clients.
  api.post('/receipts', (req, res) => res.status(410).json({ error: 'Receipt photos are no longer uploaded. Refresh the app to scan on your device.' }));
  api.post('/outings',async(req,res)=>{
    const title=clean(req.body.title,120),members=req.body.members;
    if(!title)fail('Give your outing a name.');
    if(!Array.isArray(members)||!members.length||members.length>50||members.some(id=>typeof id!=='string'||!id||id.length>100)||new Set(members).size!==members.length||!members.includes(req.user.id))fail('Choose up to 50 friends, including yourself.');
    const outing=await db.transaction(async()=>{
      const known=await knownPeople(req.user.id);
      if(members.some(id=>!known.has(id)))fail('Choose people from your friends list.',403);
      const found=await db.updateMany('users',{id:{$in:members}},{$inc:{bill_revision:1}});
      if(found.matchedCount!==members.length)fail('A friend’s profile changed. Refresh and try again.',409);
      const row={id:randomUUID(),creatorId:req.user.id,title,members,createdAt:now(),version:1};await db.insert('outings',row);return row;
    });res.status(201).json(outing);
  });
  api.patch('/outings/:id',async(req,res)=>{
    const title=clean(req.body.title,120);if(!title)fail('Give your outing a name.');
    if(!Number.isSafeInteger(req.body.version))fail('Refresh the outing and try again.',409);
    const changed=await db.update('outings',{id:req.params.id,creatorId:req.user.id,version:req.body.version},{$set:{title},$inc:{version:1}});
    if(!changed.matchedCount)fail('This outing changed or you cannot rename it. Refresh and try again.',409);
    res.json(await db.one('outings',{id:req.params.id}));
  });
  api.patch('/bills/:id/outing',async(req,res)=>{
    const outingId=req.body.outingId??null;
    if(outingId!==null&&(typeof outingId!=='string'||!outingId||outingId.length>100))fail('Choose a valid outing.');
    const bill=await db.transaction(async()=>{
      const row=await db.one('bills',{id:req.params.id});
      if(!row||row.creator_id!==req.user.id)fail('Only the bill creator can move this bill.',403);
      if(row.version!==req.body.version)fail('This bill changed. Reopen it before moving it.',409);
      await checkOuting(outingId,req.user.id,row.participants);
      await db.update('bills',{id:row.id},{$set:{'data.outingId':outingId},$inc:{version:1}});
      return billResult(await db.one('bills',{id:row.id}));
    });res.json(bill);
  });
  async function saveBill(req, existingId) {
    // Rebuild rides on the server so a modified client cannot create unequal fares.
    const bill = validateBill(req.body?.bill);
    return db.transaction(async () => {
      const existing = existingId ? await db.one('bills', { id: existingId }) : null;
      if (existingId && !existing) fail('Bill not found.', 404);
      if (existing && existing.creator_id !== req.user.id) fail('Only the creator can edit this bill.', 403);
      if (existing && existing.status !== 'draft') fail('Published bills are locked. Create a corrected bill instead.', 409);
      if (existing && req.body.version !== existing.version) fail('This bill changed on another device. Reopen it to load the latest version.', 409);
      const known = await knownPeople(req.user.id), priorParticipants = existing?.participants || [];
      await checkOuting(bill.outingId,req.user.id,bill.participants);
      for (const p of bill.participants) if (!known.has(p) && !priorParticipants.includes(p)) fail('Choose people from your friends list.');
      const people = await db.updateMany('users', { id: { $in: bill.participants } }, { $inc: { bill_revision: 1 } });
      if (people.matchedCount !== bill.participants.length) fail('A participant changed their profile. Refresh your friends list.', 409);
      const billId = existing?.id || randomUUID();
      if (existing) await db.update('bills', { id: billId }, { $set: { data: bill, participants: bill.participants }, $inc: { version: 1 } });
      else await db.insert('bills', { id: billId, creator_id: req.user.id, status: 'draft', data: bill, participants: bill.participants, version: 1, created_at: now() });
      return billResult(await db.one('bills', { id: billId }));
    });
  }
  api.post('/bills', async (req, res) => res.status(201).json(await saveBill(req)));
  api.put('/bills/:id', async (req, res) => res.json(await saveBill(req, req.params.id)));
  api.post('/bills/:id/publish', async (req, res) => {
    const result = await db.transaction(async () => {
      const row = await db.one('bills', { id: req.params.id });
      if (!row || row.creator_id !== req.user.id) fail('Bill not found.', 404);
      if (row.status !== 'draft') fail('This bill has already been sent.', 409);
      if (req.body.version !== row.version) fail('This bill changed. Reopen it before sending.', 409);
      const bill = validateBill(row.data), result = calculate(bill);
      await checkOuting(bill.outingId,req.user.id,bill.participants);
      if (result.taxMissing) fail('Enter tax before sending. Enter 0 if there was no tax.');
      if (!result.complete) fail('Assign every item, make payer contributions match the total, and resolve calculation differences before sending.');
      for (const receiver of new Set(result.transfers.map(t => t.creditorId))) {
        const payer = await getUser(receiver);
        if (!payer?.claimed) fail('Everyone receiving repayments needs to join the app first. Payment details are optional.');
      }
      const publishedAt = (options.clock?.() ?? new Date()).toISOString();
      await db.update('bills', { id: row.id }, { $set: { status: 'published', published_at: publishedAt }, $inc: { version: 1 } });
      for (const transfer of result.transfers) await db.insert('debts', { id: randomUUID(), bill_id: row.id, debtor_id: transfer.debtorId, creditor_id: transfer.creditorId, amount: transfer.amount, status: 'assigned', reference: '', note: '', assigned_at: publishedAt, updated_at: publishedAt });
      for (const p of bill.participants) await event(p, row.id, `${bill.title}: review your share and repayments.`);
      for (const debt of await db.many('debts', { bill_id: row.id })) await mail.queueDebt('owed', debt, debt.debtor_id);
      return billResult(await db.one('bills', { id: row.id }));
    }); await deliver(); res.json(result);
  });
  api.post('/repayments', async (req,res) => { const result=await payments.report(req.user,req.body); await deliver(); res.status(201).json(result); });
  api.post('/repayments/received', async (req,res) => { const result=await payments.receive(req.user,req.body); await deliver(); res.status(201).json(result); });
  api.post('/repayments/:id/action', async (req,res) => { const result=await payments.decide(req.user,req.params.id,req.body.action,req.body.note); await deliver(); res.json(result); });
  api.post('/debts/:id/action', async (req, res) => {
    const result = await db.transaction(async () => {
      const debt = await db.one('debts', { id: req.params.id });
      if (!debt) fail('Payment request not found.', 404);
      if(req.body.action==='paid') {
        if(debt.debtor_id!==req.user.id) fail('You cannot perform that action.',403);
        const amount=req.body.amountCents??payableAmount(debt);
        if(amount<=0) fail('The payment status changed. Refresh and try again.',409);
        await payments.report(req.user,{debtIds:[debt.id],amountCents:amount,requestId:req.body.requestId||randomUUID(),reference:req.body.reference});
        return debtResult(await db.one('debts',{id:debt.id}));
      }
      if(['confirm','reject'].includes(req.body.action)) {
        if(debt.creditor_id!==req.user.id) fail('You cannot perform that action.',403);
        if(debt.status!=='marked_paid') fail('The payment status changed. Refresh and try again.',409);
        await payments.decideDebt(req.user,debt,req.body.action,req.body.note);
        return debtResult(await db.one('debts',{id:debt.id}));
      }
      const { action } = req.body, isDebtor = debt.debtor_id === req.user.id;
      const transitions = {
        accept: { from: ['assigned','disputed'], to: 'accepted', allowed: isDebtor },
        dispute: { from: ['assigned','accepted'], to: 'disputed', allowed: isDebtor },
      };
      const transition = transitions[action];
      if (!transition?.allowed) fail('You cannot perform that action.', 403);
      if (!transition.from.includes(debt.status)) fail('The payment status changed. Refresh and try again.', 409);
      const note = clean(req.body.note, 500);
      if (action === 'dispute' && !note) fail('Add a short explanation.');
      const verb = { accept: 'accepted their share', dispute: 'questioned their share' }[action];
      await db.update('debts', { id: debt.id }, { $set: { status: transition.to, note: note || debt.note, updated_at: now() } });
      await event(isDebtor ? debt.creditor_id : debt.debtor_id, debt.bill_id, `${req.user.name} ${verb}.`);
      await event(req.user.id, debt.bill_id, `You ${verb.replace('their', 'your')}.`);
      const updated = await db.one('debts', { id: debt.id });
      return debtResult(updated);
    }); await deliver(); res.json(result);
  });
  api.post('/events/read', async (req, res) => { await db.updateMany('events', { user_id: req.user.id }, { $set: { is_read: true } }); res.json({ ok: true }); });
  api.use((req, res) => res.status(404).json({ error: 'This API route does not exist.' }));
  api.use((error, req, res, next) => {
    if (error.code === 11000) return res.status(409).json({ error: error.keyPattern?.username ? 'That username is already taken. Choose another.' : 'This record changed or already exists. Refresh and try again.' });
    const databaseFailure = error.name?.startsWith('Mongo') || (!!error.code && !error.status);
    if (databaseFailure) console.error('Database request failed:', error.code);
    res.status(error.status || (databaseFailure ? 503 : 400)).json({ error: error.type === 'entity.too.large' ? 'This request is too large.' : databaseFailure ? 'The database is temporarily unavailable. Your unsaved changes are still here.' : error.message || 'Something went wrong. Please try again.' });
  });
  return { api, db, mail };
}
