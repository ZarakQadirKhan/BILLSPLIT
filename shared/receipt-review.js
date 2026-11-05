export const taxNeedsEntry = bill => bill.kind !== 'ride' && bill.status !== 'published' && bill.tax?.confirmed !== true;

export function receiptReviewErrors(bill) {
  const errors=[];
  if (taxNeedsEntry(bill)) errors.push('Enter tax before sending. Enter 0 if there was no tax.');
  for(const item of bill.items||[]) if(item.priceMissing) errors.push(`Enter the price for ${item.name || 'this item'}, or confirm it was free.`);
  return errors;
}

export function validateReceiptReview(review) {
  if(!review || typeof review!=='object' || typeof review.needsTotal!=='boolean' || !Array.isArray(review.options) || review.options.length>6) throw Error('Invalid receipt review.');
  if(review.selectedOption!==null && review.selectedOption!=='manual' && (!Number.isInteger(review.selectedOption)||review.selectedOption<0||review.selectedOption>=review.options.length)) throw Error('Invalid receipt choice.');
  const options=review.options.map(o=>{
    if(!o || typeof o.label!=='string'||!o.label.trim()||o.label.length>80) throw Error('Invalid receipt option.');
    for(const field of ['taxCents','receiptTotalCents']) if(o[field]!==null&&(!Number.isSafeInteger(o[field])||o[field]<0||o[field]>10000000000)) throw Error('Invalid receipt option amount.');
    if(o.taxRate!==null&&(!Number.isFinite(o.taxRate)||o.taxRate<0||o.taxRate>100)) throw Error('Invalid receipt option tax.');
    if(![null,'before','after'].includes(o.taxBasis)) throw Error('Invalid receipt option tax basis.');
    return {label:o.label,taxCents:o.taxCents,taxRate:o.taxRate,taxBasis:o.taxBasis,receiptTotalCents:o.receiptTotalCents};
  });
  return {needsTotal:review.needsTotal,selectedOption:review.selectedOption,options};
}
