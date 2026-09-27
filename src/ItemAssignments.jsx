import React, { useState } from "react";
import { Check, Minus, Users, X } from "lucide-react";
import { money } from "../shared/calculations.js";
import {
  assignedQuantity,
  equalAllocations,
  setQuantity,
  tapAssignment,
} from "../shared/allocations.js";
import { Avatar } from "./ui.jsx";

export default function ItemAssignments({
  item,
  participants,
  user,
  onChange,
}) {
  const [sharing, setSharing] = useState(false);
  const [selected, setSelected] = useState([]);
  const remaining = item.quantity - assignedQuantity(item);
  const done = Math.abs(remaining) < 0.000001;
  const validSelected = selected.filter((id) =>
    participants.some((p) => p.id === id),
  );
  const display = (n) => Number(n.toFixed(2));
  return (
    <article className={`tap-item ${done ? "is-assigned" : ""}`}>
      <div className="tap-item-heading">
        <div>
          <h3>
            {item.name || "Untitled item"} <span>× {item.quantity}</span>
          </h3>
          <small>
            {money(
              item.lineTotalCents ??
                Math.round(item.quantity * item.unitPriceCents),
            )}{" "}
            before discounts
          </small>
        </div>
        <button
          className="share-item-button"
          aria-label={`Share ${item.name}`}
          aria-expanded={sharing}
          onClick={() => {
            setSelected(item.allocations.map((a) => a.personId));
            setSharing(!sharing);
          }}
        >
          <Users size={16} /> Share
        </button>
      </div>
      {!sharing ? (
        <>
          <p className="tap-hint">
            {item.quantity === 1
              ? "Tap who had it. Tap another friend to move it."
              : "One tap = one item. Tap again to add another."}
          </p>
          <div className="friend-taps">
            {participants.map((p, i) => {
              const quantity =
                item.allocations.find((a) => a.personId === p.id)?.quantity ||
                0;
              return (
                <div
                  className={`friend-assignment ${quantity > 0 ? "has-items" : ""}`}
                  key={p.id}
                >
                  <button
                    className="friend-tap"
                    aria-label={`${item.quantity === 1 ? "Assign" : "Add one"} ${item.name} to ${p.name}`}
                    disabled={item.quantity !== 1 && remaining <= 0.000001}
                    onClick={() =>
                      onChange((current) => tapAssignment(current, p.id))
                    }
                  >
                    <Avatar name={p.name} small index={i} />
                    <span>{p.id === user.id ? "You" : p.name}</span>
                    {quantity > 0 && (
                      <b aria-label={`${display(quantity)} assigned`}>
                        {display(quantity)}
                      </b>
                    )}
                  </button>
                  {quantity > 0 && (
                    <button
                      className="remove-assignment"
                      aria-label={`Remove one ${item.name} from ${p.name}`}
                      onClick={() =>
                        onChange((current) =>
                          setQuantity(
                            current,
                            p.id,
                            Math.max(
                              0,
                              (current.allocations.find(
                                (a) => a.personId === p.id,
                              )?.quantity || 0) - 1,
                            ),
                          ),
                        )
                      }
                    >
                      <Minus size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="sharing-panel">
          <p>Who shared this? Pick friends, then apply.</p>
          <div className="friend-taps">
            {participants.map((p, i) => (
              <button
                key={p.id}
                className="share-choice"
                aria-pressed={validSelected.includes(p.id)}
                onClick={() =>
                  setSelected((current) =>
                    current.includes(p.id)
                      ? current.filter((id) => id !== p.id)
                      : [...current, p.id],
                  )
                }
              >
                <Avatar name={p.name} small index={i} />
                {p.id === user.id ? "You" : p.name}
                {validSelected.includes(p.id) && <Check size={16} />}
              </button>
            ))}
          </div>
          <div className="sharing-actions">
            <button
              className="text-button"
              onClick={() => {
                onChange((current) => ({
                  allocations: equalAllocations(
                    current.quantity,
                    participants.map((p) => p.id),
                  ),
                }));
                setSharing(false);
              }}
            >
              Share equally
            </button>
            <button
              className="button primary"
              disabled={!validSelected.length}
              onClick={() => {
                onChange((current) => ({
                  allocations: equalAllocations(
                    current.quantity,
                    validSelected,
                  ),
                }));
                setSharing(false);
              }}
            >
              Split between {validSelected.length}
            </button>
            <button
              className="icon-button"
              aria-label="Cancel sharing"
              onClick={() => setSharing(false)}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
      <div
        className={`allocation-status ${done ? "done" : "unfinished"}`}
        role="status"
      >
        {done ? (
          <>
            <Check size={15} /> All {item.quantity} assigned
          </>
        ) : (
          <>
            {display(Math.abs(remaining))}{" "}
            {remaining > 0 ? "left to assign" : "too many assigned"}
          </>
        )}
      </div>
      <details className="precise-quantities">
        <summary>Adjust quantities</summary>
        <div className="allocation-grid">
          {participants.map((p) => (
            <label className="precise-person" key={p.id}>
              {p.id === user.id ? "You" : p.name}
              <input
                aria-label={`${item.name} quantity for ${p.name}`}
                type="number"
                inputMode="decimal"
                min="0"
                max={item.quantity}
                step="any"
                value={
                  item.allocations.find((a) => a.personId === p.id)?.quantity ??
                  0
                }
                onChange={(e) => {
                  const value = Number(e.target.value);
                  onChange((current) => setQuantity(current, p.id, value));
                }}
              />
            </label>
          ))}
        </div>
        <button
          className="text-button"
          onClick={() => onChange({ allocations: [] })}
        >
          Clear assignments
        </button>
      </details>
    </article>
  );
}
