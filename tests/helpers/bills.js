import { newBill } from '../../shared/calculations.js';

// Existing settlement fixtures represent a reviewed bill with explicit zero tax.
export function billWithTax(personId) {
  const bill = newBill(personId);
  bill.tax.confirmed = true;
  return bill;
}
