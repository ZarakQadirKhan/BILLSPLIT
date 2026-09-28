import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Receipt,
  Loader2,
  Plus,
  Copy,
  ShieldCheck,
  Users,
  ArrowRight,
} from "lucide-react";
import EmailSettings from "./EmailSettings.jsx";
import { normalizeUsername, normalizeEmail } from "../shared/identity.js";
import { money, toCents } from "../shared/calculations.js";
export const statuses = {
  assigned: "Unpaid",
  accepted: "Unpaid",
  disputed: "Unpaid · questioned",
  marked_paid: "Pending approval",
  confirmed: "Paid",
};
export const shortDate = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
export const Avatar = ({ name, index = 0, small = false }) => (
  <span aria-hidden="true" className={`avatar color-${index % 5} ${small ? "small" : ""}`}>
    {(name || "?")
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0])
      .join("")
      .toUpperCase()}
  </span>
);
export const Badge = ({ status }) => (
  <span className={`badge status-${status}`}>
    {statuses[status] ||
      (status === "draft" ? "Draft" : status === "published" ? "Open" : status)}
  </span>
);
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => previous?.focus?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function MoneyInput({ value, onChange, optional = false, ...props }) {
  return (
    <div className="money-input">
      <span>Rs</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min={props.min ?? 0}
        value={value == null ? "" : value / 100}
        onChange={(e) =>
          onChange(
            e.target.value === "" && optional ? null : toCents(e.target.value),
          )
        }
        {...props}
      />
    </div>
  );
}
export function Empty({ icon: Icon = Receipt, title, text, children }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={27} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Breakdown({ result, compact = false }) {
  return (
    <div className={`breakdown ${compact ? "compact" : ""}`}>
      <div>
        <span>Items subtotal</span>
        <span>{money(result.subtotal ?? result.items)}</span>
      </div>
      <div className="discount-line">
        <span>Discount</span>
        <span>−{money(result.discount)}</span>
      </div>
      <div>
        <span>Tax</span>
        <span>{money(result.tax)}</span>
      </div>
      <div>
        <span>Fees & adjustments</span>
        <span>{money(result.fees)}</span>
      </div>
      <div className="total">
        <span>{compact ? "Your share" : "Final bill"}</span>
        <strong>{money(result.total)}</strong>
      </div>
    </div>
  );
}
export function Onboarding({ invite, onSubmit }) {
  const [name, setName] = useState(""),
    [username, setUsername] = useState(""),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [recover, setRecover] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (invite) setName(invite.name);
  }, [invite]);
  return (
    <section className="card welcome">
      <div className="scan-icon">
        <Users size={30} />
      </div>
      <h2>
        {recover
          ? "Welcome back to your tab."
          : invite
            ? `${invite.invitedBy} saved you a seat.`
            : "A name to go with your tab."}
      </h2>
      <p>
        {recover
          ? "Enter your private recovery code to use your existing profile."
          : "Choose your name and a unique username. We’ll remember you on this device."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSubmit(
              name,
              recover ? code : null,
              recover ? null : normalizeUsername(username),
              recover ? null : normalizeEmail(email),
            );
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {recover ? (
          <label>
            Recovery code
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              rows={3}
            />
          </label>
        ) : (
          <>
            <label>
              Your name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Zarak"
                maxLength={60}
                required
              />
            </label>
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                placeholder="e.g. zarak_khan"
                minLength={3}
                maxLength={24}
                pattern="[A-Za-z0-9_]{3,24}"
                required
              />
            </label>
            <small>
              3–24 letters, numbers or underscores. Usernames are unique and not
              case-sensitive.
            </small>
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                required
              />
            </label>
            <small>
              We’ll send a verification code before delivering bill and payment
              notifications. Your email is not shown to friends.
            </small>
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy} type="submit">
          {busy ? (
            <Loader2 className="spin" size={18} />
          ) : (
            <ArrowRight size={18} />
          )}{" "}
          {recover ? "Recover my profile" : "Create my profile"}
        </button>
      </form>
      <button
        className="text-button"
        onClick={() => {
          setRecover(!recover);
          setError("");
        }}
      >
        {recover
          ? "Create a new profile instead"
          : "Already joined? Use a recovery code"}
      </button>
      <div className="welcome-note">
        <ShieldCheck size={14} /> Payments stay between friends.
      </div>
    </section>
  );
}
export function NameModal({ title, label, button, onSubmit, onClose }) {
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSubmit(name);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {label}
          <input
            autoFocus
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Ali"
          />
        </label>
        {error && <p className="inline-error">{error}</p>}
        <button className="button primary full" disabled={busy}>
          {busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}{" "}
          {button}
        </button>
      </form>
    </Modal>
  );
}
export function Profile({ user, emailDelivery, onClose, onSave, onRecovery, onUpdated }) {
  const [name, setName] = useState(user.name),
    [username, setUsername] = useState(user.username || ""),
    [email, setEmail] = useState(user.email || ""),
    [emailNotifications, setEmailNotifications] = useState(
      user.emailNotifications !== false,
    ),
    [paymentDetails, setPaymentDetails] = useState(user.paymentDetails),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Your profile" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({
              name,
              username: normalizeUsername(username),
              email: email ? normalizeEmail(email) : "",
              emailNotifications,
              paymentDetails,
            });
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
          />
        </label>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            minLength={3}
            maxLength={24}
            pattern="[A-Za-z0-9_]{3,24}"
            required
          />
        </label>
        <small>
          Your username identifies you; your private recovery code restores
          account access.
        </small>
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
          />
        </label>
        <label className="email-checkbox">
          <input
            type="checkbox"
            checked={emailNotifications}
            onChange={(e) => setEmailNotifications(e.target.checked)}
          />{" "}
          Email me about bill shares and payment updates
        </label>
        <label>
          Where should friends pay you?
          <textarea
            placeholder={
              "Account title: Ali Khan\nBank / JazzCash / EasyPaisa\nIBAN or account number\nAny transfer instructions"
            }
            rows={5}
            value={paymentDetails}
            onChange={(e) => setPaymentDetails(e.target.value)}
            maxLength={1000}
          />
        </label>
        <small>
          Visible to your friends and people on your shared bills. Transfers
          happen outside this app.
        </small>
        {error && <p className="inline-error">{error}</p>}
        <button className="button primary" disabled={busy}>
          Save profile
        </button>
      </form>
      <EmailSettings user={user} delivery={emailDelivery} onUpdated={onUpdated} />
      <div className="profile-recovery">
        <h3>Moving to another device?</h3>
        <p className="muted">
          Create a recovery code to access this same profile.
        </p>
        <button className="button" onClick={onRecovery}>
          Create new recovery code
        </button>
      </div>
    </Modal>
  );
}
export function PaymentModal({ modal, person, onClose, onSubmit, onCopy }) {
  const [reference, setReference] = useState(''), [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const paid = modal.action === 'paid', confirm = modal.action === 'confirm';
  const other = person(confirm ? modal.debt.debtor_id : modal.debt.creditor_id);
  return <Modal title={paid ? 'Pay ' + other.name : confirm ? 'Confirm payment received' : modal.action === 'dispute' ? 'Question this share' : 'Payment not received'} onClose={() => !busy && onClose()}>
    <div className="payment-amount">{money(modal.debt.amount)}</div>
    {paid && <div className="payment-destination"><p className="muted">1. Transfer outside this app using these details.</p><pre>{other.paymentDetails || 'Ask ' + other.name + ' for their payment details.'}</pre>{other.paymentDetails && onCopy && <button className="button" onClick={() => onCopy(other.paymentDetails)}><Copy size={16}/> Copy payment details</button>}<p className="muted">2. Once paid, tap below. {other.name} will confirm receipt.</p></div>}
    {confirm && <><p className="muted">{other.name} says they paid you. Check your bank, wallet or cash before confirming. Both of you will then see this as paid.</p>{modal.debt.reference && <p className="muted">Their reference: {modal.debt.reference}</p>}</>}
    {!paid && !confirm && <p className="muted">Explain what needs checking. The other person will see your note.</p>}
    <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await onSubmit({ reference, note }); } catch(e) { setError(e.message); } finally { setBusy(false); } }}>
      {paid ? <details className="optional-fields"><summary>Add a transfer reference (optional)</summary><label>Transfer reference<input value={reference} onChange={e => setReference(e.target.value)} maxLength={200} placeholder="Transaction ID or bank reference"/></label></details> : !confirm && <label>Your note<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={500} required/></label>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="button primary full" disabled={busy}>{busy ? 'Saving…' : paid ? 'I’ve paid — notify ' + other.name : confirm ? 'Yes, I received the money' : 'Send note'}</button>
      {paid && <p className="footnote">This button records your payment. It does not transfer money.</p>}
    </form>
  </Modal>;
}
