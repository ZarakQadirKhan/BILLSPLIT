const EPSILON = 0.000001;
export const assignedQuantity = (item) =>
  item.allocations.reduce((sum, a) => sum + a.quantity, 0);

export function setQuantity(item, personId, quantity) {
  return {
    allocations: [
      ...item.allocations.filter((a) => a.personId !== personId),
      ...(Number.isFinite(quantity) && quantity > 0
        ? [{ personId, quantity }]
        : []),
    ],
  };
}

// Single items move with one tap. Multiple items add one unit without overbooking.
export function tapAssignment(item, personId) {
  if (item.quantity === 1) return { allocations: [{ personId, quantity: 1 }] };
  const remaining = item.quantity - assignedQuantity(item);
  if (remaining <= EPSILON) return {};
  return setQuantity(
    item,
    personId,
    (item.allocations.find((a) => a.personId === personId)?.quantity || 0) +
      Math.min(1, remaining),
  );
}

export function equalAllocations(quantity, personIds) {
  if (!personIds.length) return [];
  const unit = quantity / personIds.length;
  return personIds.map((personId, index) => ({
    personId,
    quantity: index === personIds.length - 1 ? quantity - unit * index : unit,
  }));
}
