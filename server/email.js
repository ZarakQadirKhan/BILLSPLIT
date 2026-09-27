import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { money } from '../shared/calculations.js';

export function createEmailService(db, options = {}) {
  const from = options.from ?? process.env.GMAIL_USER;
  const password = process.env.GMAIL_APP_PASSWORD;
  const baseUrl = options.baseUrl ?? process.env.APP_BASE_URL;
  const enabled = options.enabled ?? !!(from && (options.transport || password) && baseUrl);
  let transport, running;
  if (enabled) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('Email links require an HTTPS APP_BASE_URL.');
    transport = options.transport || nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: from, pass: password }, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000, dnsTimeout: 5000, disableFileAccess: true, disableUrlAccess: true });
  }
  const link = billId => `${baseUrl || ''}/#${billId ? `bill=${encodeURIComponent(billId)}` : 'profile=1'}`;
  const queue = doc => db.insert('email_outbox', { id: randomUUID(), ...doc, status: 'pending', attempts: 0, created_at: new Date(), retry_at: new Date() });
  async function queueDebt(kind, debt, recipientId) {
    const recipient = await db.one('users', { id: recipientId });
    if (!recipient?.email_verified || !recipient.email || recipient.email_notifications === false) return;
    const row = await db.one('bills', { id: debt.bill_id });
    const debtor = await db.one('users', { id: debt.debtor_id }), creditor = await db.one('users', { id: debt.creditor_id });
    const title = row?.data.title || 'Shared bill', amount = money(debt.amount);
    const content = {
      owed: ['You have a new bill share', `You owe ${creditor.name} (@${creditor.username}) ${amount} for ${title}. Review the bill and transfer details in the app. Pay outside the app, then press “I’ve paid”.`],
      approval: ['Payment reported — please confirm receipt', `${debtor.name} (@${debtor.username}) says they paid you ${amount} for ${title}. Check your bank, wallet or cash receipt first, then open the app and choose “Confirm received” or “Not received”. This payment is pending approval.`],
      confirmed: ['Payment confirmed', `${creditor.name} confirmed receiving ${amount} from ${debtor.name} for ${title}. This payment is now marked paid for both people.`],
      rejected: ['Payment not yet confirmed', `${creditor.name} could not confirm your ${amount} payment for ${title}. It is still unpaid. Open the bill to read their note.`],
    }[kind];
    await queue({ kind, user_id: recipientId, to: recipient.email, debt_id: debt.id, bill_id: debt.bill_id, subject: content[0], text: content[1], expected_status: kind === 'owed' ? ['assigned','accepted','disputed'] : kind === 'approval' ? ['marked_paid'] : kind === 'confirmed' ? ['confirmed'] : ['accepted'] });
  }
  async function flush({ limit = 50 } = {}) {
    if (!enabled) return;
    if (running) return running;
    running = (async () => {
      const deadline = Date.now() + 240000;
      for (let i = 0; i < limit && Date.now() < deadline; i++) {
        const message = await db.claimEmail();
        if (!message) break;
        const recipient = await db.one('users', { id: message.user_id });
        const valid = recipient?.email === message.to && (message.kind === 'verification'
          ? !recipient.email_verified && recipient.email_code_hash === message.code_hash && new Date(recipient.email_code_expires) > new Date()
          : recipient.email_verified && recipient.email_notifications !== false && message.expected_status.includes((await db.one('debts', { id: message.debt_id }))?.status));
        if (!valid) { await db.update('email_outbox', { id: message.id }, { $set: { status: 'canceled', delete_after: new Date(Date.now() + 86400000) }, $unset: { text: '' } }); continue; }
        // Conservative cap below Gmail's published personal-account limit. Never buy overages.
        if (!await db.reserveEmailAttempt(100)) {
          await db.update('email_outbox', { id: message.id }, { $set: { status: 'pending', retry_at: new Date(Date.now() + 3600000) } });
          break;
        }
        try {
          await transport.sendMail({ from: { name: 'Tab Together', address: from }, to: message.to, subject: `Tab Together: ${message.subject}`, messageId: `<${message.id}@${new URL(baseUrl).hostname}>`, text: `${message.text}\n\nOpen Tab Together: ${link(message.bill_id)}\n\nNo money moves through this app. Only the recipient can confirm receipt after signing in. Manage email notifications in Your profile.` });
          await db.update('email_outbox', { id: message.id }, { $set: { status: 'sent', sent_at: new Date(), delete_after: new Date(Date.now() + 7 * 86400000) }, $unset: { text: '', code_hash: '' } });
        } catch {
          // Do not log SMTP errors: they can contain addresses, content, or credentials.
          await db.update('email_outbox', { id: message.id }, { $set: { status: message.attempts >= 6 ? 'failed' : 'pending', retry_at: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** message.attempts)) } });
        }
      }
    })().finally(() => { running = null; });
    return running;
  }
  return {
    enabled,
    queueDebt,
    queueVerification: (user, code, codeHash) => queue({ kind: 'verification', user_id: user.id, to: user.email, code_hash: codeHash, subject: 'Verify your email address', text: `Your verification code is ${code}. It expires in 15 minutes. Enter it in Your profile. If you did not request this, ignore this email.`, delete_after: new Date(Date.now() + 86400000) }),
    flush,
  };
}
