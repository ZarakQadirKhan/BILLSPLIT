export const confirmedAmount = d => d.paid_amount ?? (d.status === 'confirmed' ? d.amount : 0);
export const remainingAmount = d => Math.max(0, d.amount - confirmedAmount(d));
export const pendingAmount = d => d.pending_amount ?? (d.status === 'marked_paid' ? remainingAmount(d) : 0);
export const payableAmount = d => Math.max(0, remainingAmount(d) - pendingAmount(d));
export const paymentStatus = (amount, paid, pending) => paid === amount ? 'confirmed' : pending > 0 ? 'marked_paid' : 'accepted';
export const repaymentCard = p => ({ ...p, repaymentId: p.id, bill_id: p.allocations[0]?.billId,
  status: p.status === 'pending' ? 'marked_paid' : p.status === 'confirmed' ? 'confirmed' : 'accepted' });
