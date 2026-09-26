import express from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { calculate, validateBill, UNASSIGNED } from '../shared/calculations.js';
import { openDatabase } from './database.js';
import { MAX_RECEIPT_BYTES } from './limits.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const now = () => new Date().toISOString();
const fail = (message, status = 400) => { const error = Error(message); error.status = status; throw error; };
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const publicUser = row => ({ id: row.id, name: row.name, claimed: !!row.claimed, paymentDetails: row.payment_details || '' });
const billResult = row => ({ ...JSON.parse(row.data), id: row.id, creatorId: row.creator_id, status: row.status, version: row.version, createdAt: row.created_at });
const eventStatement = (userId, billId, message) => ({ sql: 'INSERT INTO events(id,user_id,bill_id,message,created_at) VALUES(?,?,?,?,?)', args: [randomUUID(), userId, billId, message, now()] });

export async function createApi(dataDirectory, options = {}) {
  const db = await openDatabase(dataDirectory, options);
  const getUser = userId => db.get('SELECT * FROM users WHERE id=?', userId);
  async function issueSession(userId) {
    const token = secret();
    await db.run('INSERT INTO sessions VALUES(?,?)', hash(token), userId);
    return token;
  }
  const linkStatements = (a, b) => a === b ? [] : [
    { sql: 'INSERT OR IGNORE INTO contacts VALUES(?,?)', args: [a,b] },
    { sql: 'INSERT OR IGNORE INTO contacts VALUES(?,?)', args: [b,a] },
  ];
  async function knownPeople(userId) {
    const rows = await db.all(`SELECT person_id AS id FROM contacts WHERE owner_id=?
      UNION SELECT n.user_id AS id FROM members m JOIN members n ON m.bill_id=n.bill_id
      JOIN bills b ON b.id=m.bill_id WHERE m.user_id=? AND b.status!='draft'`, userId, userId);
    return new Set([userId, ...rows.map(row => row.id)]);
  }
  async function claim(token, existingId) {
    const invitation = await db.get('SELECT * FROM invitations WHERE token_hash=?', hash(token));
    if (!invitation) fail('This invitation was already used or is no longer valid.', 404);
    const placeholder = await getUser(invitation.person_id);
    if (placeholder.claimed) fail('This profile has already been claimed.');
    const targetId = existingId || placeholder.id, statements = [];
    if (existingId && existingId !== placeholder.id) {
      const bills = await db.all('SELECT b.* FROM bills b JOIN members m ON m.bill_id=b.id WHERE m.user_id=?', placeholder.id);
      for (const row of bills) {
        const bill = JSON.parse(row.data);
        if (bill.participants.includes(existingId)) fail('You already participate in a bill under another profile. Ask the bill creator to correct the invitation.');
        bill.participants = bill.participants.map(p => p === placeholder.id ? existingId : p);
        if (bill.paidBy === placeholder.id) bill.paidBy = existingId;
        for (const item of bill.items) for (const a of item.allocations) if (a.personId === placeholder.id) a.personId = existingId;
        statements.push({ sql: 'UPDATE bills SET data=?,version=version+1 WHERE id=?', args: [JSON.stringify(bill), row.id] });
        statements.push({ sql: 'UPDATE members SET user_id=? WHERE bill_id=? AND user_id=?', args: [existingId, row.id, placeholder.id] });
      }
      statements.push(
        { sql: 'UPDATE debts SET debtor_id=? WHERE debtor_id=?', args: [existingId, placeholder.id] },
        { sql: 'UPDATE debts SET creditor_id=? WHERE creditor_id=?', args: [existingId, placeholder.id] },
        { sql: 'UPDATE events SET user_id=? WHERE user_id=?', args: [existingId, placeholder.id] },
      );
      for (const row of await db.all('SELECT owner_id FROM contacts WHERE person_id=?', placeholder.id)) statements.push(...linkStatements(row.owner_id, existingId));
      statements.push({ sql: 'DELETE FROM contacts WHERE owner_id=? OR person_id=?', args: [placeholder.id, placeholder.id] });
    }
    statements.push({ sql: 'DELETE FROM invitations WHERE person_id=?', args: [placeholder.id] }, ...linkStatements(invitation.owner_id, targetId));
    await db.batch(statements);
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
  api.use(async (req, res, next) => {
    const token = req.get('authorization')?.replace(/^Bearer /, '');
    if (token) req.user = await db.get('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=?', hash(token));
    next();
  });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Open your saved profile or use your recovery code.' });
  async function limited(req, res, next) {
    const time = Date.now(), key = hash(req.ip || 'unknown');
    // Persistent and atomic across serverless instances; never store the raw IP.
    const row = await db.get(`INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET
        count=CASE WHEN rate_limits.expires_at<=? THEN 1 ELSE rate_limits.count+1 END,
        expires_at=CASE WHEN rate_limits.expires_at<=? THEN excluded.expires_at ELSE rate_limits.expires_at END
      RETURNING count`, key, time + 60000, time, time);
    if (row.count > 30) return res.status(429).json({ error: 'Please wait a minute before trying again.' });
    next();
  }
  api.get('/health', async (req, res) => { await db.get('SELECT 1 AS ok'); res.json({ ok: true, database: db.kind }); });
  api.get('/invite/:token', limited, async (req, res) => {
    const invite = await db.get(`SELECT p.name, o.name AS invited_by FROM invitations i
      JOIN users p ON p.id=i.person_id JOIN users o ON o.id=i.owner_id WHERE token_hash=?`, hash(req.params.token));
    if (!invite) fail('This invitation is no longer available.', 404);
    res.json({ name: invite.name, invitedBy: invite.invited_by });
  });
  api.post('/register', limited, async (req, res) => {
    if (req.user) fail('This device already has a profile.');
    const name = clean(req.body.name, 60); if (!name) fail('Enter your name.');
    const result = await db.transaction(async () => {
      const userId = req.body.inviteToken ? await claim(clean(req.body.inviteToken, 100)) : randomUUID();
      const recoveryCode = secret();
      if (req.body.inviteToken) await db.run('UPDATE users SET name=?,claimed=1,recovery_hash=? WHERE id=?', name, hash(recoveryCode), userId);
      else await db.run('INSERT INTO users(id,name,claimed,recovery_hash,created_at) VALUES(?,?,1,?,?)', userId, name, hash(recoveryCode), now());
      return { token: await issueSession(userId), recoveryCode, user: publicUser(await getUser(userId)) };
    });
    res.status(201).json(result);
  });
  api.post('/recover', limited, async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE recovery_hash=? AND claimed=1', hash(clean(req.body.code, 100)));
    if (!user) fail('Recovery code not recognized.', 401);
    res.json({ token: await issueSession(user.id), user: publicUser(user) });
  });
  api.use(requireUser);
  api.post('/invite/:token/claim', async (req, res) => {
    await db.transaction(() => claim(req.params.token, req.user.id)); res.json({ ok: true });
  });
  api.get('/state', async (req, res) => {
    const userId = req.user.id;
    const state = await db.transaction(async () => {
      const rows = await db.all(`SELECT DISTINCT b.* FROM bills b LEFT JOIN members m ON m.bill_id=b.id
        WHERE b.creator_id=? OR (m.user_id=? AND b.status!='draft') ORDER BY b.created_at DESC`, userId, userId);
      const visible = new Set([userId, ...(await db.all('SELECT person_id FROM contacts WHERE owner_id=?', userId)).map(row => row.person_id)]);
      for (const row of rows) { visible.add(row.creator_id); for (const p of JSON.parse(row.data).participants) visible.add(p); }
      const ids = [...visible], people = await db.all(`SELECT * FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
      const debts = await db.all(`SELECT DISTINCT d.* FROM debts d JOIN bills b ON b.id=d.bill_id
        LEFT JOIN members m ON m.bill_id=b.id WHERE b.creator_id=? OR (m.user_id=? AND b.status!='draft')`, userId, userId);
      const events = await db.all('SELECT * FROM events WHERE user_id=? ORDER BY created_at DESC LIMIT 200', userId);
      return { user: publicUser(req.user), people: people.map(publicUser), bills: rows.map(billResult), debts, events };
    }, 'read');
    res.json(state);
  });
  api.patch('/profile', async (req, res) => {
    const name = clean(req.body.name, 60); if (!name) fail('Enter a name.');
    await db.run('UPDATE users SET name=?,payment_details=? WHERE id=?', name, clean(req.body.paymentDetails, 1000), req.user.id);
    res.json(publicUser(await getUser(req.user.id)));
  });
  api.post('/recovery-code', async (req, res) => {
    const recoveryCode = secret(); await db.run('UPDATE users SET recovery_hash=? WHERE id=?', hash(recoveryCode), req.user.id); res.json({ recoveryCode });
  });
  api.post('/friends', async (req, res) => {
    const name = clean(req.body.name, 60); if (!name) fail('Enter your friend’s name.');
    const result = await db.transaction(async () => {
      const personId = randomUUID(), token = secret();
      await db.batch([
        { sql: 'INSERT INTO users(id,name,created_at) VALUES(?,?,?)', args: [personId, name, now()] },
        ...linkStatements(req.user.id, personId),
        { sql: 'INSERT INTO invitations VALUES(?,?,?)', args: [hash(token), personId, req.user.id] },
      ]);
      return { person: publicUser(await getUser(personId)), inviteToken: token };
    });
    res.status(201).json(result);
  });
  api.post('/friends/:id/invite', async (req, res) => {
    const result = await db.transaction(async () => {
      const person = await getUser(req.params.id);
      if (!person || person.claimed || !(await knownPeople(req.user.id)).has(person.id)) fail('Cannot create an invitation for this profile.', 403);
      const token = secret();
      await db.batch([
        { sql: 'DELETE FROM invitations WHERE person_id=?', args: [person.id] },
        { sql: 'INSERT INTO invitations VALUES(?,?,?)', args: [hash(token), person.id, req.user.id] },
      ]);
      return { inviteToken: token };
    }); res.json(result);
  });
  api.post('/receipts', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_RECEIPT_BYTES }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 12 || req.body.length > MAX_RECEIPT_BYTES) fail('Upload a JPEG, PNG, or WebP image under 2 MB.');
    const bytes = req.body;
    const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
    if (!mime) fail('The file is not a supported receipt image.');
    const receiptId = randomUUID();
    await db.run('INSERT INTO receipts VALUES(?,?,?,?)', receiptId, req.user.id, mime, bytes);
    res.status(201).json({ receiptId });
  });
  api.get('/receipts/:id', async (req, res) => {
    const receipt = await db.get('SELECT * FROM receipts WHERE id=?', req.params.id);
    if (!receipt) fail('Receipt not found.', 404);
    const allowed = receipt.owner_id === req.user.id || (await db.all("SELECT b.data FROM bills b JOIN members m ON b.id=m.bill_id WHERE m.user_id=? AND b.status!='draft'", req.user.id)).some(b => JSON.parse(b.data).receiptId === receipt.id);
    if (!allowed) fail('This receipt is private.', 403);
    res.type(receipt.content_type).send(Buffer.from(receipt.bytes));
  });
  async function saveBill(req, existingId) {
    // Rebuild rides on the server so a modified client cannot create unequal fares.
    const bill = validateBill(req.body.bill);
    return db.transaction(async () => {
      const existing = existingId ? await db.get('SELECT * FROM bills WHERE id=?', existingId) : null;
      if (existingId && !existing) fail('Bill not found.', 404);
      if (existing && existing.creator_id !== req.user.id) fail('Only the creator can edit this bill.', 403);
      if (existing && existing.status !== 'draft') fail('Published bills are locked. Create a corrected bill instead.', 409);
      if (existing && req.body.version !== existing.version) fail('This bill changed on another device. Reopen it to load the latest version.', 409);
      const known = await knownPeople(req.user.id), priorParticipants = JSON.parse(existing?.data || '{}').participants || [];
      for (const p of bill.participants) if (!known.has(p) && !priorParticipants.includes(p)) fail('Choose people from your friends list.');
      if (bill.receiptId) {
        const receipt = await db.get('SELECT owner_id FROM receipts WHERE id=?', bill.receiptId);
        if (!receipt || receipt.owner_id !== req.user.id) fail('Choose your own uploaded receipt.');
      }
      const billId = existing?.id || randomUUID();
      const statements = [existing
        ? { sql: 'UPDATE bills SET data=?,version=version+1 WHERE id=?', args: [JSON.stringify(bill), billId] }
        : { sql: "INSERT INTO bills(id,creator_id,status,data,created_at) VALUES(?,?,'draft',?,?)", args: [billId, req.user.id, JSON.stringify(bill), now()] },
        { sql: 'DELETE FROM members WHERE bill_id=?', args: [billId] },
        ...bill.participants.map(p => ({ sql: 'INSERT INTO members VALUES(?,?)', args: [billId, p] })),
      ];
      await db.batch(statements);
      return billResult(await db.get('SELECT * FROM bills WHERE id=?', billId));
    });
  }
  api.post('/bills', async (req, res) => res.status(201).json(await saveBill(req)));
  api.put('/bills/:id', async (req, res) => res.json(await saveBill(req, req.params.id)));
  api.post('/bills/:id/publish', async (req, res) => {
    const result = await db.transaction(async () => {
      const row = await db.get('SELECT * FROM bills WHERE id=?', req.params.id);
      if (!row || row.creator_id !== req.user.id) fail('Bill not found.', 404);
      if (row.status !== 'draft') fail('This bill has already been sent.', 409);
      if (req.body.version !== row.version) fail('This bill changed. Reopen it before sending.', 409);
      const bill = validateBill(JSON.parse(row.data)), result = calculate(bill), payer = await getUser(bill.paidBy);
      if (!result.complete) fail('Assign every item, resolve the total difference, and fix calculation errors before sending.');
      if (!payer.claimed || !payer.payment_details.trim()) fail('The payer needs to join and save payment details first.');
      const statements = [{ sql: "UPDATE bills SET status='published',version=version+1 WHERE id=?", args: [row.id] }];
      for (const [person, share] of Object.entries(result.shares)) if (person !== UNASSIGNED && person !== bill.paidBy && share.total > 0) statements.push({ sql: "INSERT INTO debts(id,bill_id,debtor_id,creditor_id,amount,status,updated_at) VALUES(?,?,?,?,?,'assigned',?)", args: [randomUUID(), row.id, person, bill.paidBy, share.total, now()] });
      for (const p of bill.participants) statements.push(eventStatement(p, row.id, p === bill.paidBy ? `${bill.title}: your bill is ready to settle.` : `${bill.title}: ${payer.name} is waiting for you to review your share.`));
      await db.batch(statements);
      return billResult(await db.get('SELECT * FROM bills WHERE id=?', row.id));
    }); res.json(result);
  });
  api.post('/debts/:id/action', async (req, res) => {
    const result = await db.transaction(async () => {
      const debt = await db.get('SELECT * FROM debts WHERE id=?', req.params.id);
      if (!debt) fail('Payment request not found.', 404);
      const { action } = req.body, isDebtor = debt.debtor_id === req.user.id, isCreditor = debt.creditor_id === req.user.id;
      const transitions = {
        accept: { from: ['assigned','disputed'], to: 'accepted', allowed: isDebtor },
        dispute: { from: ['assigned','accepted'], to: 'disputed', allowed: isDebtor },
        paid: { from: ['assigned','accepted','disputed'], to: 'marked_paid', allowed: isDebtor },
        confirm: { from: ['marked_paid'], to: 'confirmed', allowed: isCreditor },
        reject: { from: ['marked_paid'], to: 'accepted', allowed: isCreditor },
      };
      const transition = transitions[action];
      if (!transition?.allowed) fail('You cannot perform that action.', 403);
      if (!transition.from.includes(debt.status)) fail('The payment status changed. Refresh and try again.', 409);
      const note = clean(req.body.note, 500), reference = clean(req.body.reference, 200);
      if ((action === 'dispute' || action === 'reject') && !note) fail('Add a short explanation.');
      const verb = { accept: 'accepted their share', dispute: 'questioned their share', paid: 'marked their transfer as paid', confirm: 'confirmed the payment arrived', reject: 'could not confirm the transfer' }[action];
      await db.batch([
        { sql: 'UPDATE debts SET status=?,reference=?,note=?,updated_at=? WHERE id=?', args: [transition.to, action === 'paid' ? reference : debt.reference, note || debt.note, now(), debt.id] },
        eventStatement(isDebtor ? debt.creditor_id : debt.debtor_id, debt.bill_id, `${req.user.name} ${verb}.`),
        eventStatement(req.user.id, debt.bill_id, `You ${verb.replace('their', 'your')}.`),
      ]);
      return db.get('SELECT * FROM debts WHERE id=?', debt.id);
    }); res.json(result);
  });
  api.post('/events/read', async (req, res) => { await db.run('UPDATE events SET is_read=1 WHERE user_id=?', req.user.id); res.json({ ok: true }); });
  api.use((req, res) => res.status(404).json({ error: 'This API route does not exist.' }));
  api.use((error, req, res, next) => {
    const databaseFailure = !!error.code && !error.status;
    if (databaseFailure) console.error('Database request failed:', error.code);
    res.status(error.status || (databaseFailure ? 503 : 400)).json({ error: error.type === 'entity.too.large' ? 'This file is too large. Choose a smaller receipt.' : databaseFailure ? 'The database is temporarily unavailable. Your unsaved changes are still here.' : error.message || 'Something went wrong. Please try again.' });
  });
  return { api, db };
}
