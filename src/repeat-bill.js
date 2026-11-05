import {id,newBill,normalizeBill,validateBill} from '../shared/calculations.js';

// A fresh editable bill: never carry database identity, old receipt reconciliation,
// repayment state, photos or the previous outing into the new occasion.
export function repeatBill(source) {
  const bill=structuredClone(validateBill(source));
  bill.date=newBill(bill.paidBy).date;
  bill.outingId=null;
  bill.receiptId=null;
  bill.receiptTotalCents=null;
  delete bill.receiptReview;
  bill.tax = { ...bill.tax, confirmed: false };
  bill.adjustmentCents=0;
  bill.adjustmentReason='';
  bill.items=bill.items.map(item=>({...item,id:id()}));
  return {...normalizeBill(bill),entryMode:'manual',_localDraftId:id(),_repeatTitle:source.title};
}
