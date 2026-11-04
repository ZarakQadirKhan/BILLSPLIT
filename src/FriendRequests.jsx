import React, { useEffect, useState } from 'react';
import { request } from './api.js';
import { Avatar, Modal } from './ui.jsx';
import './friend-requests.css';

export function FriendRequests({ requests = [], userId, onChanged }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  async function decide(row, action) {
    setBusy(row.id); setError('');
    try {
      await request(`/friend-requests/${row.id}/action`, { method: 'POST', body: { action, version: row.version } });
      await onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  if (!requests.length && !error) return null;
  return <section className="card friend-requests" aria-label="Friend requests">
    <h2>Friend requests <span className="count-pill">{requests.length}</span></h2>
    {error && <p className="notice error" role="alert">{error}</p>}
    {requests.map(row => {
      const incoming = row.recipient_id === userId, person = incoming ? row.sender : row.recipient;
      return <div className="friend-request-row" key={row.id}>
        <Avatar name={person?.name || 'Friend'} small/>
        <div className="friend-request-person"><strong>{person?.name || 'Friend'}</strong><small>{person?.username && `@${person.username} · `}{incoming ? 'Wants to be friends' : 'Request sent'}</small></div>
        <div className="friend-request-actions">{incoming ? <>
          <button className="button primary" disabled={!!busy} onClick={() => decide(row, 'accept')} aria-label={`Accept ${person?.name}`}>{busy === row.id ? 'Saving…' : 'Accept'}</button>
          <button className="button" disabled={!!busy} onClick={() => decide(row, 'decline')} aria-label={`Decline ${person?.name}`}>Decline</button>
        </> : <button className="button" disabled={!!busy} onClick={() => decide(row, 'cancel')} aria-label={`Cancel request to ${person?.name}`}>Cancel</button>}</div>
      </div>;
    })}
  </section>;
}

export default function FindFriends({ requests, userId, onChanged, onClose }) {
  const [people, setPeople] = useState([]), [query, setQuery] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(''), [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    request('/people').then(data => { if (active) { setPeople(data.people); setError(''); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload, requests]);
  async function changed() { await onChanged(); setReload(n => n + 1); }
  async function send(person) {
    setBusy(person.id); setError(''); setNotice('');
    try {
      await request('/friend-requests', { method: 'POST', body: { personId: person.id } });
      setPeople(rows => rows.map(p => p.id === person.id ? { ...p, relationship: 'sent' } : p));
      setNotice(`Request sent to ${person.name}. They can accept it in Friends or their inbox.`);
      await changed();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  const search = query.trim().toLocaleLowerCase().replace(/^@/, '');
  const filtered = people.filter(p => `${p.name} ${p.username || ''}`.toLocaleLowerCase().includes(search));
  return <Modal title="Find friends" onClose={onClose}>
    <p className="muted">Everyone who has joined appears below. Send a request here; they accept it in the app.</p>
    <label>Search names or usernames<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Start typing a friend’s name" autoComplete="off"/></label>
    {notice && <p className="notice" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}<button className="text-button" onClick={() => setReload(n => n + 1)}>Try again</button></p>}
    <FriendRequests requests={requests} userId={userId} onChanged={changed}/>
    {loading ? <p role="status">Loading people…</p> : <>
      <p className="muted" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'person' : 'people'}</p>
      <div className="friend-directory">{filtered.map(person => <div className="friend-directory-row" key={person.id}>
        <Avatar name={person.name} small/>
        <div className="friend-request-person"><strong>{person.name}</strong><small>@{person.username}</small></div>
        {person.relationship === 'none' ? <button className="button primary" disabled={!!busy} onClick={() => send(person)} aria-label={`Send request to ${person.name}`}>{busy === person.id ? 'Sending…' : 'Add friend'}</button> : <span className="badge">{{ friends: 'Friends', sent: 'Request sent', received: 'Accept above' }[person.relationship]}</span>}
      </div>)}</div>
      {!filtered.length && <p className="notice">No matching people. Your friend needs to join the app before you can send a request.</p>}
    </>}
  </Modal>;
}
