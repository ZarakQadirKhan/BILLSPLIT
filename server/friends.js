import { createHash, randomUUID } from 'node:crypto';

const identity = user => ({ id: user.id, name: user.name, username: user.username || null });
const reject = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const pairId = (a, b) => createHash('sha256').update(JSON.stringify([a, b].sort())).digest('hex');

export async function pendingFriendRequests(db, userId) {
  const rows = await db.many('friend_requests', { status: 'pending', $or: [{ sender_id: userId }, { recipient_id: userId }] }, { sort: { updated_at: -1 } });
  const users = await db.many('users', { id: { $in: rows.flatMap(r => [r.sender_id, r.recipient_id]) } }, { projection: { _id: 0, id: 1, name: 1, username: 1 } });
  return rows.map(row => ({ ...row, sender: users.find(u => u.id === row.sender_id), recipient: users.find(u => u.id === row.recipient_id) }));
}

export function mountFriends(api, db, link) {
  const notify = (userId, requestId, message) => db.insert('events', { id: randomUUID(), user_id: userId, bill_id: null, friend_request_id: requestId, message, is_read: false, created_at: new Date().toISOString() });
  api.get('/people', async (req, res) => {
    // The signed-in directory exposes names only, never profiles or transfer details.
    const users = await db.many('users', { claimed: true, id: { $ne: req.user.id } }, { projection: { _id: 0, id: 1, name: 1, username: 1 }, sort: { name: 1, id: 1 } });
    const contacts = new Set((await db.many('contacts', { owner_id: req.user.id })).map(c => c.person_id));
    const requests = await pendingFriendRequests(db, req.user.id);
    res.json({ people: users.map(u => {
      const request = requests.find(r => r.sender_id === u.id || r.recipient_id === u.id);
      return { ...identity(u), relationship: contacts.has(u.id) ? 'friends' : request ? request.sender_id === req.user.id ? 'sent' : 'received' : 'none' };
    }) });
  });
  api.post('/friend-requests', async (req, res) => {
    const recipientId = req.body?.personId;
    if (typeof recipientId !== 'string' || !recipientId || recipientId.length > 100 || recipientId === req.user.id) reject('Choose another person who has joined the app.');
    if ((await db.rateLimit('friend-request:' + req.user.id)).count > 30) reject('Please wait a minute before sending more requests.', 429);
    const result = await db.transaction(async () => {
      // Lock the pair in stable order so concurrent or crossed requests cannot duplicate.
      for (const id of [req.user.id, recipientId].sort()) {
        const changed = await db.update('users', { id, claimed: true }, { $inc: { friend_revision: 1 } });
        if (!changed.matchedCount) reject('This person has not joined the app.', 404);
      }
      if (await db.one('contacts', { owner_id: req.user.id, person_id: recipientId })) reject('You are already friends.', 409);
      const id = pairId(req.user.id, recipientId), old = await db.one('friend_requests', { id });
      if (old?.status === 'pending') {
        if (old.sender_id === req.user.id) return old;
        reject('This person already sent you a request. Accept it in Friends.', 409);
      }
      const row = { id, sender_id: req.user.id, recipient_id: recipientId, status: 'pending', version: (old?.version || 0) + 1, updated_at: new Date().toISOString() };
      if (old) await db.update('friend_requests', { id }, { $set: row });
      else await db.insert('friend_requests', row);
      await notify(recipientId, id, `${req.user.name} sent you a friend request.`);
      return row;
    });
    res.json(result);
  });
  api.post('/friend-requests/:id/action', async (req, res) => {
    const { action, version } = req.body || {};
    if (!['accept', 'decline', 'cancel'].includes(action) || !Number.isSafeInteger(version)) reject('Choose a valid request action.');
    const result = await db.transaction(async () => {
      const row = await db.one('friend_requests', { id: req.params.id });
      if (!row || (action === 'cancel' ? row.sender_id : row.recipient_id) !== req.user.id) reject('You cannot change this request.', 403);
      if (row.status !== 'pending' || row.version !== version) reject('This request has changed. Refresh your friends list.', 409);
      const status = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' }[action];
      const updated = await db.update('friend_requests', { id: row.id, status: 'pending', version }, { $set: { status, updated_at: new Date().toISOString() }, $inc: { version: 1 } });
      if (!updated.modifiedCount) reject('This request has changed. Refresh your friends list.', 409);
      if (action === 'accept') {
        await link(row.sender_id, row.recipient_id);
        await notify(row.sender_id, row.id, `${req.user.name} accepted your friend request.`);
      }
      await db.updateMany('events', { user_id: row.recipient_id, friend_request_id: row.id }, { $set: { is_read: true } });
      return { ok: true, status };
    });
    res.json(result);
  });
}
