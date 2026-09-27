import React, { useState } from 'react';
import { request } from './api.js';

export default function EmailSettings({ user, delivery, onUpdated }) {
  const [code, setCode] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function run(path, body, success) {
    setBusy(true); setError(''); setMessage('');
    try { await request(path, { method: 'POST', body }); await onUpdated(); setMessage(success); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="profile-recovery"><h3>Email notifications</h3>
    {delivery?.issue && <p className="notice" role="status">{delivery.issue === 'authentication' ? 'The Gmail sender could not sign in. The app owner needs to check the sender address and App Password in Vercel.' : delivery.issue === 'connection' ? 'The app could not connect to the email server. Your email is queued for another attempt.' : 'Email delivery is delayed. The app owner can check the safe delivery logs.'} Your bill and payment records are unaffected.</p>}
    {!delivery?.issue && delivery?.queued > 0 && <p className="muted" role="status">Email queued. Delivery has not been confirmed yet. Check your inbox and spam folder.</p>}
    {!user.emailConfigured && <p className="notice">Email delivery is not configured yet. The app owner needs to connect the Gmail sender. In-app balances and payment approval still work.</p>}
    {!user.email ? <p className="muted">Save your email address above to receive bill and payment updates.</p> : user.emailVerified ? <p className="settled-message">Verified: {user.email}</p> : <>
      <p className="muted">Verify {user.email} to receive bill shares and payment updates. Save any email changes before requesting a code.</p>
      <form onSubmit={e => { e.preventDefault(); run('/email/verify', { code }, 'Email verified. Payment notifications are enabled.'); }}>
        <label>Email verification code<input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required/></label>
        <div className="action-row"><button className="button primary" disabled={busy || !user.emailConfigured}>Verify email</button><button className="button" type="button" disabled={busy || !user.emailConfigured} onClick={() => run('/email/resend', {}, 'Verification email queued. Check your inbox and spam folder.')}>Send a new code</button></div>
      </form>
    </>}
    {user.emailVerified && <button className="text-button" disabled={busy || !user.emailConfigured} onClick={() => run('/email/retry', {}, 'Email delivery retry requested.')}>Retry failed emails</button>}
    {message && <p role="status">{message}</p>}{error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
