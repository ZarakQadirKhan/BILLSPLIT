import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  ScanLine,
  Upload,
  Check,
  AlertCircle,
  Loader2,
  Save,
  Send,
  Users,
  Equal,
  X,
  ImageIcon,
} from "lucide-react";
import { calculate, id, money, validateBill } from "../shared/calculations.js";
import { parseReceipt } from "../shared/parser.js";
import { request, prepareImage, scanImage } from "./api.js";
import { Avatar, Breakdown, MoneyInput, Empty } from "./ui.jsx";
import ItemAssignments from "./ItemAssignments.jsx";
import { assignedQuantity, equalAllocations } from "../shared/allocations.js";

export default function BillEditor({
  initial,
  people,
  user,
  onAddFriend,
  onProfile,
  onClose,
  onSaved,
  notify,
}) {
  const [bill, setBill] = useState(() => structuredClone(initial)),
    [step, setStep] = useState("review"),
    [image, setImage] = useState(""),
    [raw, setRaw] = useState(""),
    [warnings, setWarnings] = useState([]),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(null),
    [busy, setBusy] = useState(false);
  const fileRef = useRef(),
    result = calculate(bill),
    payer = people.find((p) => p.id === bill.paidBy),
    participants = people.filter((p) => bill.participants.includes(p.id));
  const change = (patch) => setBill((current) => ({ ...current, ...patch }));
  const changeItem = (itemId, patch) =>
    setBill((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId
          ? { ...item, ...(typeof patch === "function" ? patch(item) : patch) }
          : item,
      ),
    }));
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image);
    },
    [image],
  );
  useEffect(() => {
    const before = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  const applyText = (text) => {
    const parsed = parseReceipt(text),
      { charges } = parsed;
    setWarnings(parsed.warnings);
    setBill((current) => ({
      ...current,
      title: current.title || parsed.title,
      items: parsed.items,
      receiptTotalCents: parsed.receiptTotalCents,
      discount: {
        ...current.discount,
        type:
          charges.discountCents != null
            ? "fixed"
            : charges.discountRate != null
              ? "percent"
              : "none",
        amountCents: charges.discountCents || 0,
        rate: charges.discountRate || 0,
        eligibleCapCents: null,
        maxDiscountCents: null,
      },
      tax: {
        ...current.tax,
        type: charges.taxRate != null ? "percent" : "fixed",
        amountCents: charges.taxCents || 0,
        rate: charges.taxRate || 0,
      },
      deliveryCents: charges.deliveryCents || 0,
      serviceCents: charges.serviceCents || 0,
      tipCents: charges.tipCents || 0,
    }));
  };
  const upload = async (file) => {
    if (!file) return;
    if (
      bill.items.length &&
      !window.confirm(
        "Scan a new receipt and replace the current items and charges?",
      )
    )
      return;
    setError("");
    setProgress({ status: "Preparing your receipt", progress: 0 });
    try {
      const blob = await prepareImage(file);
      setImage(URL.createObjectURL(blob));
      const text = await scanImage(blob, setProgress);
      setRaw(text);
      applyText(text);
      notify("Receipt read. Please check every item and the final total.");
    } catch (e) {
      setError(
        `Receipt scan: ${e.message} You can still enter or correct the items manually.`,
      );
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const addItem = () =>
    change({
      items: [
        ...bill.items,
        {
          id: id(),
          name: "",
          quantity: 1,
          unitPriceCents: 0,
          lineTotalCents: null,
          eligible: true,
          allocations: [],
        },
      ],
    });
  const toggleParticipant = (personId) => {
    if (bill.participants.includes(personId)) {
      if (personId === bill.paidBy) return;
      change({
        participants: bill.participants.filter((p) => p !== personId),
        items: bill.items.map((item) => ({
          ...item,
          allocations: item.allocations.filter((a) => a.personId !== personId),
        })),
      });
    } else change({ participants: [...bill.participants, personId] });
  };
  const save = async (publish) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      validateBill(bill);
      let saved = await request(bill.id ? `/bills/${bill.id}` : "/bills", {
        method: bill.id ? "PUT" : "POST",
        body: { bill, version: bill.version },
      });
      setBill(saved);
      if (publish)
        saved = await request(`/bills/${saved.id}/publish`, {
          method: "POST",
          body: { version: saved.version },
        });
      await onSaved(saved);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="text-button back-button"
        onClick={() =>
          window.confirm(
            "Leave this editor? Save your draft first to keep recent changes.",
          ) && onClose()
        }
      >
        <ArrowLeft size={16} /> Back to your space
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ONE RECEIPT. EVERYONE’S SHARE.</div>
          <h1>
            {initial.id ? "Edit your bill" : "Split a bill"}
            <span>.</span>
          </h1>
          <p>Review the numbers, then choose who had what.</p>
        </div>
        <button
          className="button"
          onClick={() => save(false)}
          disabled={busy || !!progress}
        >
          <Save size={17} /> Save draft
        </button>
      </div>
      <div className="editor-steps">
        <button
          className={step === "review" ? "active" : ""}
          onClick={() => setStep("review")}
        >
          <span>1</span> Review the bill
        </button>
        <ArrowRight size={17} />
        <button
          className={step === "split" ? "active" : ""}
          onClick={() => setStep("split")}
        >
          <span>2</span> Split & send
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss">
            <X size={17} />
          </button>
        </div>
      )}
      <div className="editor-layout">
        <div className="editor-main">
          {step === "review" ? (
            <>
              <section className="card">
                <div className="section-heading">
                  <h2>
                    <ReceiptMark /> The receipt
                  </h2>
                  <span className="badge">Read on your device</span>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => upload(e.target.files?.[0])}
                />
                <div
                  className={`receipt-drop ${progress ? "scanning" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!progress) upload(e.dataTransfer.files[0]);
                  }}
                >
                  {image ? (
                    <img src={image} alt="Uploaded receipt for review" />
                  ) : (
                    <span className="scan-icon">
                      <ScanLine size={30} />
                    </span>
                  )}
                  <div>
                    <h3>
                      {progress
                        ? "Reading your receipt…"
                        : image
                          ? "Your receipt · device-only preview"
                          : "Scan your receipt here"}
                    </h3>
                    <p>
                      {progress
                        ? `${progress.status} · ${Math.round(progress.progress * 100)}%`
                        : "Photos stay on this device and are not saved. Only reviewed bill details are stored. You can also enter items manually."}
                    </p>
                    {progress ? (
                      <progress
                        max="1"
                        value={progress.progress}
                        aria-label="Receipt scan progress"
                      />
                    ) : (
                      <button
                        className="button"
                        onClick={() => fileRef.current.click()}
                      >
                        <Upload size={16} />
                        {image ? "Replace receipt" : "Choose a photo"}
                      </button>
                    )}
                  </div>
                </div>
                <details className="ocr-text">
                  <summary>Paste or review receipt text</summary>
                  <p className="muted">
                    Useful for a digital receipt, or to fix text the scanner
                    missed. Applying replaces the current items and charges.
                  </p>
                  <textarea
                    aria-label="Receipt text"
                    rows={7}
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    placeholder={
                      "Restaurant name\nCold drinks 6 x 200 1200\nTotal 1200"
                    }
                  />
                  <button
                    className="button"
                    disabled={!raw.trim() || !!progress}
                    onClick={() => {
                      if (
                        !bill.items.length ||
                        window.confirm(
                          "Replace the current items and charges with this text?",
                        )
                      )
                        applyText(raw);
                    }}
                  >
                    Extract items from text
                  </button>
                </details>
                {warnings.length > 0 && (
                  <div className="scan-warnings">
                    {warnings.map((warning, i) => (
                      <p key={i}>
                        <AlertCircle size={14} />
                        {warning}
                      </p>
                    ))}
                  </div>
                )}
                <div className="form-grid receipt-info">
                  <label>
                    Bill name
                    <input
                      placeholder="e.g. Friday dinner at Kolachi"
                      value={bill.title}
                      onChange={(e) => change({ title: e.target.value })}
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Date
                    <input
                      type="date"
                      value={bill.date}
                      onChange={(e) => change({ date: e.target.value })}
                    />
                  </label>
                </div>
              </section>
              <section className="card">
                <div className="section-heading">
                  <h2>
                    Check the items{" "}
                    <span className="count-pill">{bill.items.length}</span>
                  </h2>
                  <button className="text-button" onClick={addItem}>
                    <Plus size={16} /> Add item
                  </button>
                </div>
                {!bill.items.length ? (
                  <Empty
                    icon={ScanLine}
                    title="What did everyone order?"
                    text="Scan a receipt or add the items by hand."
                  >
                    <button className="button" onClick={addItem}>
                      <Plus size={16} /> Add first item
                    </button>
                  </Empty>
                ) : (
                  <div className="item-list">
                    {bill.items.map((item, index) => (
                      <div className="editable-item" key={item.id}>
                        <div className="item-number">
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div className="item-fields">
                          <label className="item-name-field">
                            <span>
                              Item name{" "}
                              {item.uncertain && (
                                <span className="review-tag">Check scan</span>
                              )}
                            </span>
                            <input
                              aria-label={`Item ${index + 1} name`}
                              value={item.name}
                              onChange={(e) =>
                                changeItem(item.id, {
                                  name: e.target.value,
                                  uncertain: false,
                                })
                              }
                              placeholder="Food or drink"
                              maxLength={200}
                            />
                          </label>
                          <div className="item-numbers">
                            <label>
                              Quantity
                              <input
                                aria-label={`Item ${index + 1} quantity`}
                                type="number"
                                min="0.001"
                                step="any"
                                value={item.quantity}
                                onChange={(e) =>
                                  changeItem(item.id, {
                                    quantity: Number(e.target.value),
                                    lineTotalCents: null,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Unit price
                              <MoneyInput
                                aria-label={`Item ${index + 1} unit price`}
                                value={item.unitPriceCents}
                                onChange={(value) =>
                                  changeItem(item.id, {
                                    unitPriceCents: value,
                                    lineTotalCents: null,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Line total
                              <MoneyInput
                                aria-label={`Item ${index + 1} total`}
                                value={
                                  item.lineTotalCents ??
                                  Math.round(
                                    item.quantity * item.unitPriceCents,
                                  )
                                }
                                onChange={(value) =>
                                  changeItem(item.id, { lineTotalCents: value })
                                }
                              />
                            </label>
                          </div>
                          <details className="item-options">
                            <summary>Item options</summary>
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={item.eligible !== false}
                                onChange={(e) =>
                                  changeItem(item.id, {
                                    eligible: e.target.checked,
                                  })
                                }
                              />{" "}
                              Eligible for discount
                            </label>
                            {item.lineTotalCents != null && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  changeItem(item.id, { lineTotalCents: null })
                                }
                              >
                                Manual total · reset
                              </button>
                            )}
                          </details>
                        </div>
                        <button
                          className="icon-button danger"
                          aria-label={`Remove ${item.name || "item"}`}
                          onClick={() =>
                            change({
                              items: bill.items.filter((i) => i.id !== item.id),
                            })
                          }
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <details
                className="card optional-fields"
                key={"discount-" + (bill.discount.type !== "none")}
                open={bill.discount.type !== "none" || undefined}
              >
                <summary>
                  Discount{" "}
                  <span>
                    {result.discount
                      ? "−" + money(result.discount)
                      : "Add a discount or cap"}
                  </span>
                </summary>
                <div className="form-grid">
                  <label>
                    Discount type
                    <select
                      value={bill.discount.type}
                      onChange={(e) =>
                        change({
                          discount: { ...bill.discount, type: e.target.value },
                        })
                      }
                    >
                      <option value="none">No discount</option>
                      <option value="percent">Percentage off</option>
                      <option value="fixed">Fixed amount off</option>
                    </select>
                  </label>
                  {bill.discount.type === "percent" && (
                    <label>
                      Discount percentage
                      <div className="suffix-input">
                        <input
                          aria-label="Discount percentage"
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          value={bill.discount.rate}
                          onChange={(e) =>
                            change({
                              discount: {
                                ...bill.discount,
                                rate: Number(e.target.value),
                              },
                            })
                          }
                        />
                        <span>%</span>
                      </div>
                    </label>
                  )}
                  {bill.discount.type === "fixed" && (
                    <label>
                      Discount amount
                      <MoneyInput
                        value={bill.discount.amountCents}
                        onChange={(value) =>
                          change({
                            discount: { ...bill.discount, amountCents: value },
                          })
                        }
                      />
                    </label>
                  )}
                  {bill.discount.type !== "none" && (
                    <>
                      <label>
                        Apply to the first (optional)
                        <MoneyInput
                          aria-label="Discount eligible amount limit"
                          optional
                          placeholder="All eligible items"
                          value={bill.discount.eligibleCapCents}
                          onChange={(value) =>
                            change({
                              discount: {
                                ...bill.discount,
                                eligibleCapCents: value,
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Maximum saving (optional)
                        <MoneyInput
                          aria-label="Maximum discount"
                          optional
                          placeholder="No cap"
                          value={bill.discount.maxDiscountCents}
                          onChange={(value) =>
                            change({
                              discount: {
                                ...bill.discount,
                                maxDiscountCents: value,
                              },
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                </div>
                {bill.discount.type !== "none" && (
                  <div className="discount-explainer">
                    <Check size={17} />
                    <span>
                      {bill.discount.type === "percent"
                        ? `${bill.discount.rate}% on ${money(result.eligibleBase)}`
                        : "Applied to eligible items"}{" "}
                      → <strong>{money(result.discount)} saved</strong>
                    </span>
                  </div>
                )}
              </details>
              <details
                className="card optional-fields"
                key={"tax-" + Boolean(result.tax || result.fees)}
                open={Boolean(result.tax || result.fees) || undefined}
              >
                <summary>
                  Tax, fees & rounding{" "}
                  <span>
                    {result.tax || result.fees
                      ? money(result.tax + result.fees)
                      : "Add only if needed"}
                  </span>
                </summary>
                <div className="form-grid">
                  <label>
                    Tax type
                    <select
                      value={bill.tax.type}
                      onChange={(e) =>
                        change({ tax: { ...bill.tax, type: e.target.value } })
                      }
                    >
                      <option value="fixed">Exact amount from receipt</option>
                      <option value="percent">Percentage</option>
                    </select>
                  </label>
                  {bill.tax.type === "fixed" ? (
                    <label>
                      Tax amount
                      <MoneyInput
                        value={bill.tax.amountCents}
                        onChange={(value) =>
                          change({ tax: { ...bill.tax, amountCents: value } })
                        }
                      />
                    </label>
                  ) : (
                    <label>
                      Tax percentage
                      <div className="suffix-input">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          value={bill.tax.rate}
                          onChange={(e) =>
                            change({
                              tax: {
                                ...bill.tax,
                                rate: Number(e.target.value),
                              },
                            })
                          }
                        />
                        <span>%</span>
                      </div>
                    </label>
                  )}
                  <label>
                    Tax applies to
                    <select
                      value={bill.tax.basis}
                      onChange={(e) =>
                        change({ tax: { ...bill.tax, basis: e.target.value } })
                      }
                    >
                      <option value="after">Items after discount</option>
                      <option value="before">Items before discount</option>
                    </select>
                  </label>
                  <label>
                    Delivery
                    <MoneyInput
                      value={bill.deliveryCents}
                      onChange={(deliveryCents) => change({ deliveryCents })}
                    />
                  </label>
                  <label>
                    Service / packaging
                    <MoneyInput
                      value={bill.serviceCents}
                      onChange={(serviceCents) => change({ serviceCents })}
                    />
                  </label>
                  <label>
                    Tip
                    <MoneyInput
                      value={bill.tipCents}
                      onChange={(tipCents) => change({ tipCents })}
                    />
                  </label>
                  <label>
                    Split additional fees
                    <select
                      value={bill.chargeSplit}
                      onChange={(e) => change({ chargeSplit: e.target.value })}
                    >
                      <option value="proportional">
                        In proportion to food shares
                      </option>
                      <option value="equal">
                        Equally between participants
                      </option>
                    </select>
                  </label>
                </div>
                <details className="manual-adjustment">
                  <summary>Manual adjustment or rounding</summary>
                  <div className="form-grid">
                    <label>
                      Adjustment (+ or −)
                      <MoneyInput
                        min={-100000000}
                        value={bill.adjustmentCents}
                        onChange={(adjustmentCents) =>
                          change({ adjustmentCents })
                        }
                      />
                    </label>
                    <label>
                      Reason
                      <input
                        value={bill.adjustmentReason}
                        onChange={(e) =>
                          change({ adjustmentReason: e.target.value })
                        }
                        placeholder="e.g. Restaurant rounding"
                        maxLength={200}
                      />
                    </label>
                  </div>
                </details>
              </details>
            </>
          ) : (
            <>
              <section className="card">
                <div className="section-heading">
                  <h2>Who was there?</h2>
                  <button className="text-button" onClick={onAddFriend}>
                    <Plus size={16} /> Add a friend
                  </button>
                </div>
                <div className="participant-picker">
                  {people.map((p, i) => (
                    <button
                      key={p.id}
                      className={`participant-chip ${bill.participants.includes(p.id) ? "selected" : ""}`}
                      onClick={() => toggleParticipant(p.id)}
                      aria-pressed={bill.participants.includes(p.id)}
                    >
                      <Avatar name={p.name} small index={i} />
                      {p.id === user.id ? `${p.name} (you)` : p.name}
                      {p.username && <small>@{p.username}</small>}
                      {bill.participants.includes(p.id) && <Check size={15} />}
                    </button>
                  ))}
                </div>
                <div className="payer-select">
                  <label>
                    Who paid the original bill?
                    <select
                      value={bill.paidBy}
                      onChange={(e) => change({ paidBy: e.target.value })}
                    >
                      {participants.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                          {p.username ? ` (@${p.username})` : ""}
                          {p.id === user.id ? " (you)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <small>
                    The payer’s own share is automatically excluded from what
                    they’re owed.
                  </small>
                </div>
                {!payer?.claimed ? (
                  <div className="notice">
                    <AlertCircle size={17} />
                    <span>
                      The payer must accept their invitation and add payment
                      details before you send this bill.
                    </span>
                  </div>
                ) : (
                  !payer.paymentDetails && (
                    <div className="notice">
                      <AlertCircle size={17} />
                      <span>
                        {payer.id === user.id
                          ? "Add your payment details so friends know where to transfer."
                          : `${payer.name} needs to add their payment details.`}
                      </span>
                      {payer.id === user.id && (
                        <button className="text-button" onClick={onProfile}>
                          Add details
                        </button>
                      )}
                    </div>
                  )
                )}
              </section>
              <section className="card">
                <div className="section-heading">
                  <h2>Who had what?</h2>
                  <span className="badge">Tap to assign</span>
                </div>
                <p className="muted">
                  Tap your friends below each item. Sharing everything? Split
                  the whole bill in one go.
                </p>
                {bill.items.length > 0 && (
                  <button
                    className="button equal-all"
                    onClick={() => {
                      if (
                        bill.items.some((item) => item.allocations.length) &&
                        !window.confirm(
                          "Replace current item assignments with an equal split?",
                        )
                      )
                        return;
                      change({
                        items: bill.items.map((item) => {
                          return {
                            ...item,
                            allocations: equalAllocations(
                              item.quantity,
                              bill.participants,
                            ),
                          };
                        }),
                      });
                    }}
                  >
                    <Equal size={18} /> Split all items equally
                  </button>
                )}
                {bill.items.length === 0 && (
                  <Empty
                    title="Add your items first"
                    text="Return to the review step to add food and drinks."
                  />
                )}
                <div className="assignment-progress" role="status">
                  <span>
                    {
                      bill.items.filter(
                        (item) =>
                          Math.abs(item.quantity - assignedQuantity(item)) <
                          0.000001,
                      ).length
                    }{" "}
                    of {bill.items.length} items sorted
                  </span>
                  <progress
                    aria-label="Items fully assigned"
                    max={Math.max(1, bill.items.length)}
                    value={
                      bill.items.filter(
                        (item) =>
                          Math.abs(item.quantity - assignedQuantity(item)) <
                          0.000001,
                      ).length
                    }
                  />
                </div>
                {bill.items.map((item) => (
                  <ItemAssignments
                    key={item.id}
                    item={item}
                    participants={participants}
                    user={user}
                    onChange={(patch) => changeItem(item.id, patch)}
                  />
                ))}
              </section>
              <section className="card">
                <h2>Everyone’s final share</h2>
                {participants.map((p, i) => {
                  const share = result.shares[p.id];
                  return (
                    <div className="share-preview" key={p.id}>
                      <Avatar name={p.name} index={i} />
                      <div className="row-description">
                        <strong>
                          {p.name}
                          {p.id === user.id && " (you)"}
                        </strong>
                        <small>
                          {p.id === bill.paidBy
                            ? "Payer · no transfer to themselves"
                            : `Pays ${payer?.name}`}
                        </small>
                        <small>
                          Items {money(share.items)} − discount{" "}
                          {money(share.discount)} + tax & fees{" "}
                          {money(share.tax + share.fees)}
                        </small>
                      </div>
                      <strong>{money(share.total)}</strong>
                    </div>
                  );
                })}
              </section>
            </>
          )}
        </div>
        <aside className="editor-summary">
          <section className="card summary-card">
            <div className="section-heading">
              <h2>Bill total</h2>
              <span className="live-badge">
                <span /> Live
              </span>
            </div>
            <Breakdown result={result} />
            <label className="charged-total">
              Final charged amount (receipt)
              <MoneyInput
                optional
                aria-label="Final charged amount"
                placeholder="Optional receipt check"
                value={bill.receiptTotalCents}
                onChange={(receiptTotalCents) => change({ receiptTotalCents })}
              />
            </label>
            {result.receiptDifference !== 0 ? (
              <div className="reconciliation mismatch">
                <AlertCircle size={17} />
                <div>
                  <strong>
                    {money(Math.abs(result.receiptDifference))} difference
                  </strong>
                  <p>
                    Calculated total is{" "}
                    {result.receiptDifference > 0 ? "below" : "above"} the
                    charged amount.
                  </p>
                  <button
                    className="text-button"
                    onClick={() =>
                      change({
                        adjustmentCents:
                          bill.adjustmentCents + result.receiptDifference,
                        adjustmentReason:
                          "Adjustment to match the receipt total",
                      })
                    }
                  >
                    Add an explicit adjustment
                  </button>
                  <button
                    className="text-button"
                    onClick={() => change({ receiptTotalCents: result.total })}
                  >
                    Use calculated total
                  </button>
                </div>
              </div>
            ) : (
              bill.receiptTotalCents != null && (
                <div className="reconciliation matched">
                  <Check size={16} /> Matches your receipt
                </div>
              )
            )}
            {step === "split" && (
              <>
                <div
                  className={`assignment-summary ${result.unassignedUnits > 0.000001 || result.errors.length ? "unfinished" : "done"}`}
                >
                  <div>
                    <span>Assigned</span>
                    <strong>{money(result.assigned)}</strong>
                  </div>
                  <div>
                    <span>Left to assign</span>
                    <strong>{money(result.unassigned)}</strong>
                  </div>
                  {result.unassignedUnits > 0.000001 && (
                    <small>
                      {Number(result.unassignedUnits.toFixed(3))} item units
                      still unassigned
                    </small>
                  )}
                </div>
                <div className="payer-summary">
                  <span>{payer?.name} paid</span>
                  <strong>{money(result.total)}</strong>
                  <span>Their own share</span>
                  <strong>
                    −{money(result.shares[bill.paidBy]?.total || 0)}
                  </strong>
                  <span>They should receive</span>
                  <strong>
                    {money(
                      result.total - (result.shares[bill.paidBy]?.total || 0),
                    )}
                  </strong>
                </div>
              </>
            )}
            {result.errors.map((e, i) => (
              <p key={i} className="inline-error">
                {e}
              </p>
            ))}
            {step === "review" ? (
              <button
                className="button primary full"
                onClick={() => setStep("split")}
                disabled={!bill.items.length || !!progress}
              >
                Choose who had what <ArrowRight size={17} />
              </button>
            ) : (
              <>
                <button
                  className="button primary full"
                  onClick={() => save(true)}
                  disabled={
                    !result.complete ||
                    !payer?.claimed ||
                    !payer?.paymentDetails ||
                    busy ||
                    !!progress
                  }
                >
                  {busy ? (
                    <Loader2 size={17} className="spin" />
                  ) : (
                    <Send size={17} />
                  )}{" "}
                  Send everyone their share
                </button>
                <p className="footnote">
                  Review before sending. Sent bills are locked to keep accepted
                  shares consistent.
                </p>
              </>
            )}
            <button
              className="button full"
              onClick={() => save(false)}
              disabled={busy || !!progress}
            >
              <Save size={16} /> Save as draft
            </button>
          </section>
          {image && (
            <details className="receipt-reference">
              <summary>
                <ImageIcon size={16} /> View original receipt
              </summary>
              <img src={image} alt="Original receipt, full size" />
            </details>
          )}
        </aside>
      </div>
      <div className="mobile-editor-action">
        <span>
          Bill total<strong>{money(result.total)}</strong>
        </span>
        {step === "review" ? (
          <button
            className="button primary"
            disabled={!bill.items.length || !!progress}
            onClick={() => {
              setStep("split");
              window.scrollTo?.({ top: 0, behavior: "instant" });
            }}
          >
            Next: choose people <ArrowRight size={16} />
          </button>
        ) : (
          <button
            className="button primary"
            disabled={
              !result.complete ||
              !payer?.claimed ||
              !payer?.paymentDetails ||
              busy ||
              !!progress
            }
            onClick={() => save(true)}
          >
            {busy ? "Sending…" : "Send shares"}
          </button>
        )}
      </div>
    </>
  );
}
function ReceiptMark() {
  return <ScanLine size={19} />;
}
