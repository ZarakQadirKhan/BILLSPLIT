import React from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Copy,
  ArrowUpRight,
  Pencil,
  Receipt,
  ImageIcon,
  Wallet,
  AlertCircle,
} from "lucide-react";
import { calculate, money } from "../shared/calculations.js";
import { Avatar, Badge, Breakdown, shortDate } from "./ui.jsx";
import { confirmedAmount, remainingAmount, payableAmount, pendingAmount, repaymentCard } from '../shared/payments.js';
import { BalanceList } from './HomeOverview.jsx';

export default function BillDetails({
  bill,
  bills = [bill],
  debts,
  repayments = [],
  person,
  user,
  onBack,
  onEdit,
  onAction,
  onCopy,
  onRepeat,
  outing,
  onOpenOuting,
  onMoveOuting,
}) {
  const isRide = bill.kind === "ride";
  const result = calculate(bill),
    isPayer = result.payments.some(p => p.personId === user.id),
    myDebts = debts.filter((d) => d.debtor_id === user.id);
  const received = debts
      .filter((d) => d.creditor_id === user.id)
      .reduce((s, d) => s + confirmedAmount(d), 0),
    outstanding = debts
      .filter((d) => d.status !== "confirmed" && d.creditor_id === user.id)
      .reduce((s, d) => s + remainingAmount(d), 0),
    settled =
      bill.status === "published" &&
      debts.every((d) => d.status === "confirmed");
  return (
    <>
      <button className="text-button back-button" onClick={onBack}>
        <ArrowLeft size={16} /> Back to your space
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {shortDate(bill.date)} · {bill.participants.length} PEOPLE
          </div>
          <h1>
            {bill.title}
            <span>.</span>
          </h1>
          <p>
            Paid by {result.payments.map(p => person(p.personId).name).join(" & ")} <span>·</span> Created by{" "}
            {person(bill.creatorId).name}
          </p>
        </div>
        <div className="heading-actions">
          {onRepeat&&<button className="button" onClick={onRepeat}><Copy size={16}/> Do this again</button>}
          <Badge status={settled ? "confirmed" : bill.status} />
          {bill.status === "draft" && bill.creatorId === user.id && (
            <button className="button primary" onClick={onEdit}>
              <Pencil size={16} /> Continue editing
            </button>
          )}
        </div>
      </div>
      <div className="outing-actions">{outing&&<button className="button" onClick={onOpenOuting}>In {outing.title}</button>}{bill.creatorId===user.id&&onMoveOuting&&<button className="text-button" onClick={onMoveOuting}>{outing?'Change outing':'Add to an outing'}</button>}</div>
      {bill.status === "draft" && (
        <div className="notice">
          <AlertCircle size={18} />
          <span>
            This draft is only visible to you. Shares have not been sent.
          </span>
        </div>
      )}
      <div className="editor-layout">
        <div className="editor-main">
          {isPayer && bill.status !== "draft" && (
            <section className="payer-banner">
              <div>
                <span>
                  <Wallet size={17} /> You contributed
                </span>
                <strong>{money(result.payments.find(p => p.personId === user.id)?.amountCents || 0)}</strong>
              </div>
              <div>
                <span>Your own share</span>
                <strong>{money(result.shares[user.id]?.total || 0)}</strong>
              </div>
              <div>
                <span>Confirmed received</span>
                <strong>{money(received)}</strong>
              </div>
              <div>
                <span>Still owed to you</span>
                <strong>{money(outstanding)}</strong>
              </div>
            </section>
          )}
          {repayments.some(p=>p.status==='pending'&&p.allocations.some(a=>a.billId===bill.id))&&<section className="card"><h2>Payments awaiting confirmation</h2><BalanceList debts={repayments.filter(p=>p.status==='pending'&&p.allocations.some(a=>a.billId===bill.id)).map(repaymentCard)} user={user} person={person} bills={bills} filter="all" onOpen={()=>{}} onConfirm={d=>onAction(d,'confirm')} onReject={d=>onAction(d,'reject')}/></section>}
          {myDebts.map(myDebt => { const payer = person(myDebt.creditor_id); return (
            <section className="card my-payment" key={myDebt.id}>
              <div className="section-heading">
                <h2>Your payment</h2>
                <Badge status={myDebt.status} />
              </div>
              <div className="my-share">
                <Avatar name={payer.name} />
                <div>
                  <small>
                    {myDebt.status === "confirmed"
                      ? "You paid"
                      : "Still to pay"}{" "}
                    {payer.name}
                  </small>
                  <strong>{money(myDebt.status==='confirmed'?confirmedAmount(myDebt):payableAmount(myDebt))}</strong>
                  <p className="muted">Original share {money(myDebt.amount)} · Confirmed {money(confirmedAmount(myDebt))} · Awaiting confirmation {money(pendingAmount(myDebt))}</p>
                  {myDebt.last_rejected_at && payableAmount(myDebt) > 0 && <p className="notice">Payment not confirmed: {myDebt.last_rejection_note}. This amount is still owed; the clock runs from when this bill was first sent.</p>}
                </div>
              </div>
              <details className="optional-breakdown"><summary>How your share was calculated</summary><Breakdown result={result.shares[user.id]} compact /></details>
              {myDebt.note && <p className="notice">Note: {myDebt.note}</p>}
              {myDebt.reference && (
                <p className="muted">Transfer reference: {myDebt.reference}</p>
              )}
              <div className="action-row">
                {payableAmount(myDebt)>0 && (
                  <button
                    className="button primary"
                    onClick={() => onAction(myDebt, "paid")}
                  >
                    <CheckCheck size={17} /> I’ve paid
                  </button>
                )}
                {["assigned", "accepted"].includes(myDebt.status) && (
                  <button
                    className="button"
                    onClick={() => onAction(myDebt, "dispute")}
                  >
                    Question this share
                  </button>
                )}
                {myDebt.status === "marked_paid" && (
                  <p className="muted">
                    Pending approval from {payer.name}. Don’t pay the pending amount again. Only confirmed payments reduce the outstanding balance.
                  </p>
                )}
                {myDebt.status === "confirmed" && (
                  <span className="settled-message">
                    <CheckCheck size={18} /> This payment has been confirmed.
                  </span>
                )}
              </div>
            </section>
          ); })}
          <section className="card">
            <div className="section-heading">
              <h2>{isRide ? "Passenger payments" : "Everyone’s share"}</h2>
              <span className="badge">{bill.participants.length} people</span>
            </div>
            {bill.participants
              .map((personId, i) => {
                const p = person(personId),
                  share = result.shares[personId],
                  personDebts = debts.filter((d) => d.debtor_id === personId);
                return (
                  <div className="participant-detail" key={personId}>
                    <div className="share-preview">
                      <Avatar name={p.name} index={i} />
                      <div className="row-description">
                        <strong>
                          {p.name}
                          {personId === user.id && " (you)"}
                        </strong>
                        <small>
                          {(() => {
                            const incoming = debts.filter(d => d.creditor_id === personId).reduce((sum, d) => sum + remainingAmount(d), 0);
                            const outgoing = personDebts.reduce((sum, d) => sum + remainingAmount(d), 0);
                            return bill.status === 'draft' ? 'Draft share' : incoming > 0 ? 'Still receives ' + money(incoming) : outgoing > 0 ? 'Still pays ' + money(outgoing) : 'Settled';
                          })()}
                        </small>
                      </div>
                      <strong>{money(share.total)}</strong>
                    </div>
                    <details className="participant-breakdown optional-breakdown"><summary>See items & calculation</summary>
                      {bill.items
                        .filter((item) =>
                          item.allocations.some(
                            (a) => a.personId === personId && a.quantity > 0,
                          ),
                        )
                        .map((item) => (
                          <span key={item.id}>
                            {Number(
                              item.allocations
                                .find((a) => a.personId === personId)
                                .quantity.toFixed(3),
                            )}{" "}
                            × {item.name}
                          </span>
                        ))}
                      <p>
                        Items {money(share.items)} − discount{" "}
                        {money(share.discount)} + tax {money(share.tax)} + fees{" "}
                        {money(share.fees)}
                      </p>
                    </details>
                    {personDebts.map(debt => (
                      <div className="debt-footer" key={debt.id}><span>To {person(debt.creditor_id).name}: {money(payableAmount(debt))} to pay · {money(pendingAmount(debt))} pending · {money(confirmedAmount(debt))} confirmed</span>
                        <Badge status={debt.status} />
                        {debt.note && (
                          <span className="debt-note">{debt.note}</span>
                        )}
                        {debt.reference && <small>Ref: {debt.reference}</small>}
                        {debt.creditor_id === user.id && payableAmount(debt) > 0 && <button className="button primary" onClick={()=>onAction(debt,"received")}><Check size={16}/> Mark as paid</button>}
                        {debt.creditor_id === user.id && debt.status === "marked_paid" && debt.pending_amount==null && (
                          <div className="action-row">
                            <button
                              className="button primary"
                              onClick={() => onAction(debt, "confirm")}
                            >
                              <Check size={16} /> Confirm received
                            </button>
                            <button
                              className="button"
                              onClick={() => onAction(debt, "reject")}
                            >
                              Not received
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
          </section>
          <details className="card optional-fields">
            <summary>{isRide ? "Ride details" : "Original bill items"}</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>{isRide ? "Split" : "Unit price"}</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.name}
                        {item.eligible === false && (
                          <small className="block">
                            Excluded from discount
                          </small>
                        )}
                      </td>
                      <td>{item.quantity}</td>
                      <td>{isRide ? "Equally" : money(item.unitPriceCents)}</td>
                      <td>
                        {money(
                          item.lineTotalCents ??
                            Math.round(item.quantity * item.unitPriceCents),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
        <aside className="editor-summary">
          <section className="card">
            <h2>The bill, explained</h2>
            <Breakdown result={result} />
            {bill.discount.type === "percent" && (
              <p className="footnote">
                {bill.discount.rate}% off {money(result.eligibleBase)} of
                eligible items
                {bill.discount.maxDiscountCents != null
                  ? `, saving at most ${money(bill.discount.maxDiscountCents)}`
                  : ""}
                .
              </p>
            )}
            <p className="footnote" hidden={isRide}>
              Tax uses item shares {bill.tax.basis} discount. Extra fees are
              split{" "}
              {bill.chargeSplit === "equal"
                ? "equally"
                : "in proportion to food shares"}
              .
            </p>
            {bill.adjustmentCents !== 0 && (
              <p className="footnote">
                Adjustment: {money(bill.adjustmentCents)} —{" "}
                {bill.adjustmentReason}
              </p>
            )}
          </section>
          {[...new Set(myDebts.filter(d => d.status !== "confirmed").map(d => d.creditor_id))].map(creditorId => { const payer = person(creditorId); return (
            <section className="card payment-destination" key={creditorId}>
              <div className="section-heading">
                <h2>Pay {payer.name}</h2>
                <Wallet size={19} />
              </div>
              <pre>
                {payer.paymentDetails ||
                  "Payment details have not been added yet."}
              </pre>
              {payer.paymentDetails && (
                <button
                  className="button full"
                  onClick={() => onCopy(payer.paymentDetails)}
                >
                  <Copy size={16} /> Copy transfer details
                </button>
              )}
              <p className="footnote">
                Transfer through your bank or wallet, then mark your share as
                paid here.
              </p>
            </section>
          ); })}
        </aside>
      </div>
    </>
  );
}
