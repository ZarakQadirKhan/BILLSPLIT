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

export default function BillDetails({
  bill,
  debts,
  person,
  user,
  onBack,
  onEdit,
  onAction,
  onCopy,
}) {
  const isRide = bill.kind === "ride";
  const result = calculate(bill),
    payer = person(bill.paidBy),
    isPayer = user.id === bill.paidBy,
    myDebt = debts.find((d) => d.debtor_id === user.id);
  const received = debts
      .filter((d) => d.status === "confirmed")
      .reduce((s, d) => s + d.amount, 0),
    outstanding = debts
      .filter((d) => d.status !== "confirmed")
      .reduce((s, d) => s + d.amount, 0),
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
            Paid by {payer.name} <span>·</span> Created by{" "}
            {person(bill.creatorId).name}
          </p>
        </div>
        <div className="heading-actions">
          <Badge status={settled ? "confirmed" : bill.status} />
          {bill.status === "draft" && bill.creatorId === user.id && (
            <button className="button primary" onClick={onEdit}>
              <Pencil size={16} /> Continue editing
            </button>
          )}
        </div>
      </div>
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
                  <Wallet size={17} /> You paid the bill
                </span>
                <strong>{money(result.total)}</strong>
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
          {myDebt && (
            <section className="card my-payment">
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
                      : myDebt.status === "marked_paid"
                        ? "Pending approval from"
                        : "You owe"}{" "}
                    {payer.name}
                  </small>
                  <strong>{money(myDebt.amount)}</strong>
                </div>
              </div>
              <details className="optional-breakdown"><summary>How your share was calculated</summary><Breakdown result={result.shares[user.id]} compact /></details>
              {myDebt.note && <p className="notice">Note: {myDebt.note}</p>}
              {myDebt.reference && (
                <p className="muted">Transfer reference: {myDebt.reference}</p>
              )}
              <div className="action-row">
                {["assigned", "accepted", "disputed"].includes(
                  myDebt.status,
                ) && (
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
                    Pending approval from {payer.name}. Your outstanding balance
                    updates after confirmation.
                  </p>
                )}
                {myDebt.status === "confirmed" && (
                  <span className="settled-message">
                    <CheckCheck size={18} /> Payment received. You’re all
                    square.
                  </span>
                )}
              </div>
            </section>
          )}
          <section className="card">
            <div className="section-heading">
              <h2>{isRide ? "Passenger payments" : "Everyone’s share"}</h2>
              <span className="badge">{bill.participants.length} people</span>
            </div>
            {bill.participants
              .filter((personId) => !isRide || personId !== bill.paidBy)
              .map((personId, i) => {
                const p = person(personId),
                  share = result.shares[personId],
                  debt = debts.find((d) => d.debtor_id === personId);
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
                          {personId === bill.paidBy
                            ? "Paid the bill · own share excluded from transfers"
                            : !p.claimed
                              ? "Invitation not yet accepted"
                              : `Pays ${payer.name}`}
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
                    {debt && (
                      <div className="debt-footer">
                        <Badge status={debt.status} />
                        {debt.note && (
                          <span className="debt-note">{debt.note}</span>
                        )}
                        {debt.reference && <small>Ref: {debt.reference}</small>}
                        {isPayer && debt.status === "marked_paid" && (
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
                    )}
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
          {!isPayer && (
            <section className="card payment-destination">
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
          )}
        </aside>
      </div>
    </>
  );
}
