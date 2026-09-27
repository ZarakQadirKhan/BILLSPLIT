import test from "node:test";
import assert from "node:assert/strict";
import {
  assignedQuantity,
  equalAllocations,
  tapAssignment,
} from "../shared/allocations.js";

test("tap allocations cap the last fractional unit and preserve other people", () => {
  const item = { quantity: 2.5, allocations: [{ personId: "a", quantity: 2 }] };
  const next = { ...item, ...tapAssignment(item, "b") };
  assert.equal(assignedQuantity(next), 2.5);
  assert.equal(next.allocations[1].quantity, 0.5);
  assert.deepEqual(tapAssignment(next, "b"), {});
});
test("equal shares cover the exact quantity, including thirds and selected subsets", () => {
  for (const quantity of [1, 6, 2.5]) {
    const allocations = equalAllocations(quantity, ["a", "b", "c"]);
    assert.equal(assignedQuantity({ allocations }), quantity);
    assert.deepEqual(
      allocations.map((a) => a.personId),
      ["a", "b", "c"],
    );
  }
  assert.deepEqual(equalAllocations(1, []), []);
});
