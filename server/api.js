import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { calculate, validateBill, UNASSIGNED } from '../shared/calculations.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const now = () => new Date().toISOString();
const fail = (message, status = 400) => { const error = Error(message); error.status = status; throw error; };
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const publicUser = row => ({ id: row.id, name: row.name, claimed: !!row.claimed, paymentDetails: row.payment_details || '' });

export function createApi(dataDirectory) {
  mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(`${dataDirectory}/tab-together.sqlite`);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0, payment_details TEXT NOT NULL DEFAULT '', recovery_hash TEXT UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS contacts(owner_id TEXT NOT NULL REFERENCES users(id), person_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(owner_id, person_id));
    CREATE TABLE IF NOT EXISTS invitations(token_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES users(id), owner_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS bills(id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members(bill_id TEXT NOT NULL REFERENCES bills(id), user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(bill_id,user_id));
    CREATE TABLE IF NOT EXISTS debts(id TEXT PRIMARY KEY, bill_id TEXT NOT NULL REFERENCES bills(id), debtor_id TEXT NOT NULL REFERENCES users(id), creditor_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, status TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), bill_id TEXT, message TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), content_type TEXT NOT NULL, bytes BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
    CREATE INDEX IF NOT EXISTS idx_debts_debtor ON debts(debtor_id);
    CREATE INDEX IF NOT EXISTS idx_debts_creditor ON debts(creditor_id);
    CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id,created_at);
    PRAGMA optimize;`);
  const getUser = userId => db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  const event = (userId, billId, message) => db.prepare('INSERT INTO events(id,user_id,bill_id,message,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), userId, billId, message, now());
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const issueSession = userId => { const token = secret(); db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token), userId); return token; };
  const linked = (a, b) => a === b || !!db.prepare('SELECT 1 FROM contacts WHERE owner_id=? AND person_id=?').get(a, b) || !!db.prepare("SELECT 1 FROM members m JOIN members n ON m.bill_id=n.bill_id JOIN bills b ON b.id=m.bill_id WHERE m.user_id=? AND n.user_id=? AND b.status!='draft' LIMIT 1").get(a, b);
  const link = (a, b) => { if (a !== b) { db.prepare('INSERT OR IGNORE INTO contacts VALUES(?,?)').run(a, b); db.prepare('INSERT OR IGNORE INTO contacts VALUES(?,?)').run(b, a); } };
  const canReadBill = (bill, userId) => bill.creator_id === userId || (bill.status !== 'draft' && !!db.prepare('SELECT 1 FROM members WHERE bill_id=? AND user_id=?').get(bill.id, userId));
  const billResult = row => ({ ...JSON.parse(row.data), id: row.id, creatorId: row.creator_id, status: row.status, version: row.version, createdAt: row.created_at });
  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request rejected.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-site request rejected.' });
    next();
  });
  api.use(express.json({ limit: '1mb' }));
  api.use((req, res, next) => { const token = req.get('authorization')?.replace(/^Bearer /, ''); if (token) { const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(hash(token)); if (session) req.user = getUser(session.user_id); } next(); });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Open your saved profile or use your recovery code.' });
  const rate = new Map();
  const limited = (req, res, next) => { const key = req.ip, time = Date.now(), bucket = rate.get(key); if (bucket && time - bucket.start < 60000) { if (++bucket.count > 30) return res.status(429).json({ error: 'Please wait a minute before trying again.' }); } else rate.set(key, { start: time, count: 1 }); if (rate.size > 10000) for (const [key, b] of rate) if (time - b.start > 60000) rate.delete(key); next(); };
  const claim = (token, existingId) => {
    const invitation = db.prepare('SELECT * FROM invitations WHERE token_hash=?').get(hash(token));
    if (!invitation) fail('This invitation was already used or is no longer valid.', 404);
    const placeholder = getUser(invitation.person_id);
    if (placeholder.claimed) fail('This profile has already been claimed.');
    const targetId = existingId || placeholder.id;
    if (existingId && existingId !== placeholder.id) {
      const bills = db.prepare('SELECT b.* FROM bills b JOIN members m ON m.bill_id=b.id WHERE m.user_id=?').all(placeholder.id);
      for (const row of bills) {
        const bill = JSON.parse(row.data);
        // Merging two participants on a published bill would change its accounting identity.
        if (bill.participants.includes(existingId)) fail('You already participate in a bill under another profile. Ask the bill creator to correct the invitation.');
        bill.participants = bill.participants.map(p => p === placeholder.id ? existingId : p);
        if (bill.paidBy === placeholder.id) bill.paidBy = existingId;
        for (const item of bill.items) for (const a of item.allocations) if (a.personId === placeholder.id) a.personId = existingId;
        db.prepare('UPDATE bills SET data=?,version=version+1 WHERE id=?').run(JSON.stringify(bill), row.id);
        db.prepare('UPDATE members SET user_id=? WHERE bill_id=? AND user_id=?').run(existingId, row.id, placeholder.id);
      }
      db.prepare('UPDATE debts SET debtor_id=? WHERE debtor_id=?').run(existingId, placeholder.id);
      db.prepare('UPDATE debts SET creditor_id=? WHERE creditor_id=?').run(existingId, placeholder.id);
      db.prepare('UPDATE events SET user_id=? WHERE user_id=?').run(existingId, placeholder.id);
      for (const row of db.prepare('SELECT owner_id FROM contacts WHERE person_id=?').all(placeholder.id)) link(row.owner_id, existingId);
      db.prepare('DELETE FROM contacts WHERE owner_id=? OR person_id=?').run(placeholder.id, placeholder.id);
    }
    db.prepare('DELETE FROM invitations WHERE person_id=?').run(placeholder.id);
    link(invitation.owner_id, targetId);
    return targetId;
  };
  api.get('/health', (req, res) => res.json({ ok: true }));
  api.get('/invite/:token', limited, (req, res) => { const invite = db.prepare('SELECT person_id,owner_id FROM invitations WHERE token_hash=?').get(hash(req.params.token)); if (!invite) fail('This invitation is no longer available.', 404); res.json({ name: getUser(invite.person_id).name, invitedBy: getUser(invite.owner_id).name }); });
  api.post('/register', limited, (req, res) => {
    if (req.user) fail('This device already has a profile.');
    const name = clean(req.body.name, 60); if (!name) fail('Enter your name.');
    const result = transaction(() => {
      const userId = req.body.inviteToken ? claim(clean(req.body.inviteToken, 100)) : randomUUID();
      const recoveryCode = secret();
      if (req.body.inviteToken) db.prepare('UPDATE users SET name=?,claimed=1,recovery_hash=? WHERE id=?').run(name, hash(recoveryCode), userId);
      else db.prepare('INSERT INTO users(id,name,claimed,recovery_hash,created_at) VALUES(?,?,1,?,?)').run(userId, name, hash(recoveryCode), now());
      return { token: issueSession(userId), recoveryCode, user: publicUser(getUser(userId)) };
    });
    res.status(201).json(result);
  });
  api.post('/recover', limited, (req, res) => { const user = db.prepare('SELECT * FROM users WHERE recovery_hash=? AND claimed=1').get(hash(clean(req.body.code, 100))); if (!user) fail('Recovery code not recognized.', 401); res.json({ token: issueSession(user.id), user: publicUser(user) }); });
  api.use(requireUser);
  api.post('/invite/:token/claim', (req, res) => { transaction(() => claim(req.params.token, req.user.id)); res.json({ ok: true }); });
  api.get('/state', (req, res) => {
    const userId = req.user.id;
    const rows = db.prepare("SELECT DISTINCT b.* FROM bills b LEFT JOIN members m ON m.bill_id=b.id WHERE b.creator_id=? OR (m.user_id=? AND b.status!='draft') ORDER BY b.created_at DESC").all(userId, userId);
    const visible = new Set([userId, ...db.prepare('SELECT person_id FROM contacts WHERE owner_id=?').all(userId).map(r => r.person_id)]);
    for (const row of rows) { visible.add(row.creator_id); for (const p of JSON.parse(row.data).participants) visible.add(p); }
    const people = [...visible].map(p => publicUser(getUser(p)));
    const debts = rows.flatMap(row => db.prepare('SELECT * FROM debts WHERE bill_id=?').all(row.id));
    res.json({ user: publicUser(req.user), people, bills: rows.map(billResult), debts, events: db.prepare('SELECT * FROM events WHERE user_id=? ORDER BY created_at DESC LIMIT 200').all(userId) });
  });
  api.patch('/profile', (req, res) => { const name = clean(req.body.name, 60); if (!name) fail('Enter a name.'); const paymentDetails = clean(req.body.paymentDetails, 1000); db.prepare('UPDATE users SET name=?,payment_details=? WHERE id=?').run(name, paymentDetails, req.user.id); res.json(publicUser(getUser(req.user.id))); });
  api.post('/recovery-code', (req, res) => { const recoveryCode = secret(); db.prepare('UPDATE users SET recovery_hash=? WHERE id=?').run(hash(recoveryCode), req.user.id); res.json({ recoveryCode }); });
  api.post('/friends', (req, res) => {
    const name = clean(req.body.name, 60); if (!name) fail('Enter your friend’s name.');
    const result = transaction(() => { const personId = randomUUID(), token = secret(); db.prepare('INSERT INTO users(id,name,created_at) VALUES(?,?,?)').run(personId, name, now()); link(req.user.id, personId); db.prepare('INSERT INTO invitations VALUES(?,?,?)').run(hash(token), personId, req.user.id); return { person: publicUser(getUser(personId)), inviteToken: token }; });
    res.status(201).json(result);
  });
  api.post('/friends/:id/invite', (req, res) => { const person = getUser(req.params.id); if (!person || person.claimed || !linked(req.user.id, person.id)) fail('Cannot create an invitation for this profile.', 403); const token = secret(); transaction(() => { db.prepare('DELETE FROM invitations WHERE person_id=?').run(person.id); db.prepare('INSERT INTO invitations VALUES(?,?,?)').run(hash(token), person.id, req.user.id); }); res.json({ inviteToken: token }); });
  api.post('/receipts', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 12) fail('Upload a JPEG, PNG, or WebP image under 8 MB.');
    const b = req.body;
    const valid = (b[0] === 0xff && b[1] === 0xd8) || b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP');
    if (!valid) fail('The file is not a supported receipt image.');
    const receiptId = randomUUID(); db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(receiptId, req.user.id, req.get('content-type'), b); res.status(201).json({ receiptId });
  });
  api.get('/receipts/:id', (req, res) => { const receipt = db.prepare('SELECT * FROM receipts WHERE id=?').get(req.params.id); if (!receipt) fail('Receipt not found.', 404); const allowed = receipt.owner_id === req.user.id || db.prepare("SELECT b.* FROM bills b JOIN members m ON b.id=m.bill_id WHERE m.user_id=? AND b.status!='draft'").all(req.user.id).some(b => JSON.parse(b.data).receiptId === receipt.id); if (!allowed) fail('This receipt is private.', 403); res.type(receipt.content_type).send(Buffer.from(receipt.bytes)); });
  const saveBill = (req, existing) => {
    const bill = validateBill(req.body.bill);
    if (existing && existing.creator_id !== req.user.id) fail('Only the creator can edit this bill.', 403);
    if (existing && existing.status !== 'draft') fail('Published bills are locked. Create a corrected bill instead.', 409);
    if (existing && req.body.version !== existing.version) fail('This bill changed on another device. Reopen it to load the latest version.', 409);
    for (const p of bill.participants) if (!getUser(p) || (!linked(req.user.id, p) && !JSON.parse(existing?.data || '{}').participants?.includes(p))) fail('Choose people from your friends list.');
    if (bill.receiptId) { const receipt = db.prepare('SELECT owner_id FROM receipts WHERE id=?').get(bill.receiptId); if (!receipt || receipt.owner_id !== req.user.id) fail('Choose your own uploaded receipt.'); }
    const billId = existing?.id || randomUUID();
    transaction(() => { if (existing) db.prepare('UPDATE bills SET data=?,version=version+1 WHERE id=?').run(JSON.stringify(bill), billId); else db.prepare("INSERT INTO bills(id,creator_id,status,data,created_at) VALUES(?,?,'draft',?,?)").run(billId, req.user.id, JSON.stringify(bill), now()); db.prepare('DELETE FROM members WHERE bill_id=?').run(billId); for (const p of bill.participants) db.prepare('INSERT INTO members VALUES(?,?)').run(billId, p); });
    return billResult(db.prepare('SELECT * FROM bills WHERE id=?').get(billId));
  };
  api.post('/bills', (req, res) => res.status(201).json(saveBill(req)));
  api.put('/bills/:id', (req, res) => { const row = db.prepare('SELECT * FROM bills WHERE id=?').get(req.params.id); if (!row) fail('Bill not found.', 404); res.json(saveBill(req, row)); });
  api.post('/bills/:id/publish', (req, res) => {
    const result = transaction(() => { const row = db.prepare('SELECT * FROM bills WHERE id=?').get(req.params.id); if (!row || row.creator_id !== req.user.id) fail('Bill not found.', 404); if (row.status !== 'draft') fail('This bill has already been sent.', 409); if (req.body.version !== row.version) fail('This bill changed. Reopen it before sending.', 409); const bill = validateBill(JSON.parse(row.data)), result = calculate(bill); if (!result.complete) fail('Assign every item, resolve the total difference, and fix calculation errors before sending.');
      if (!getUser(bill.paidBy).claimed || !getUser(bill.paidBy).payment_details.trim()) fail('The payer needs to join and save payment details first.');
      db.prepare("UPDATE bills SET status='published',version=version+1 WHERE id=?").run(row.id);
      for (const [person, share] of Object.entries(result.shares)) if (person !== UNASSIGNED && person !== bill.paidBy && share.total > 0) db.prepare("INSERT INTO debts(id,bill_id,debtor_id,creditor_id,amount,status,updated_at) VALUES(?,?,?,?,?,'assigned',?)").run(randomUUID(), row.id, person, bill.paidBy, share.total, now());
      for (const p of bill.participants) event(p, row.id, p === bill.paidBy ? `${bill.title}: your bill is ready to settle.` : `${bill.title}: ${getUser(bill.paidBy).name} is waiting for you to review your share.`);
      return billResult(db.prepare('SELECT * FROM bills WHERE id=?').get(row.id));
    }); res.json(result);
  });
  api.post('/debts/:id/action', (req, res) => {
    const result = transaction(() => { const debt = db.prepare('SELECT * FROM debts WHERE id=?').get(req.params.id); if (!debt) fail('Payment request not found.', 404); const { action } = req.body, isDebtor = debt.debtor_id === req.user.id, isCreditor = debt.creditor_id === req.user.id;
      const transitions = { accept: { from: ['assigned','disputed'], to: 'accepted', allowed: isDebtor }, dispute: { from: ['assigned','accepted'], to: 'disputed', allowed: isDebtor }, paid: { from: ['accepted'], to: 'marked_paid', allowed: isDebtor }, confirm: { from: ['marked_paid'], to: 'confirmed', allowed: isCreditor }, reject: { from: ['marked_paid'], to: 'accepted', allowed: isCreditor } };
      const transition = transitions[action]; if (!transition?.allowed) fail('You cannot perform that action.', 403); if (!transition.from.includes(debt.status)) fail('The payment status changed. Refresh and try again.', 409);
      const note = clean(req.body.note, 500), reference = clean(req.body.reference, 200); if ((action === 'dispute' || action === 'reject') && !note) fail('Add a short explanation.');
      db.prepare('UPDATE debts SET status=?,reference=?,note=?,updated_at=? WHERE id=?').run(transition.to, action === 'paid' ? reference : debt.reference, note || debt.note, now(), debt.id);
      const verb = { accept: 'accepted their share', dispute: 'questioned their share', paid: 'marked their transfer as paid', confirm: 'confirmed the payment arrived', reject: 'could not confirm the transfer' }[action];
      event(isDebtor ? debt.creditor_id : debt.debtor_id, debt.bill_id, `${req.user.name} ${verb}.`);
      event(req.user.id, debt.bill_id, `You ${verb.replace('their', 'your')}.`);
      return db.prepare('SELECT * FROM debts WHERE id=?').get(debt.id);
    }); res.json(result);
  });
  api.post('/events/read', (req, res) => { db.prepare('UPDATE events SET is_read=1 WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });
  api.use((req, res) => res.status(404).json({ error: 'This API route does not exist.' }));
  api.use((error, req, res, next) => { if (!error.status || error.status >= 500) console.error(error.message); res.status(error.status || 400).json({ error: error.type === 'entity.too.large' ? 'This file is too large.' : error.message || 'Something went wrong. Please try again.' }); });
  return { api, db };
}
