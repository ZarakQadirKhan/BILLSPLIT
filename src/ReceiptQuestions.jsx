import React, {useState} from 'react';
import { money } from '../shared/calculations.js';
import { chooseReceiptOption } from '../shared/receipt-review.js';
import { MoneyInput } from './ui.jsx';

export default function ReceiptQuestions({bill,onChange,onItemChange}) {
  const review=bill.receiptReview,missing=bill.items.filter(i=>i.priceMissing);
  if(!review?.options?.length&&!missing.length&&!(review?.needsTotal&&bill.receiptTotalCents==null))return null;
  return <section className="card receipt-questions" aria-label="Receipt questions">
    <h2>A quick check</h2><p className="muted">Help us finish the details the receipt couldn’t confirm.</p>
    {!!review?.options?.length&&<fieldset><legend>How was this bill paid?</legend><div className="receipt-option-list">
      {review.options.map((o,index)=><button type="button" className={`receipt-option ${review.selectedOption===index?'selected':''}`} key={index} aria-pressed={review.selectedOption===index} onClick={()=>onChange(chooseReceiptOption(bill,index))}><strong>{o.label}</strong><span>{o.taxRate!=null?`${o.taxRate}% tax`:''}{o.taxCents!=null?` · ${money(o.taxCents)} tax`:''}</span><small>{o.receiptTotalCents!=null?`${money(o.receiptTotalCents)} total`:'Final total needs your confirmation'}</small></button>)}
      <button type="button" className="button" aria-pressed={review.selectedOption==='manual'} onClick={()=>onChange(chooseReceiptOption(bill,'manual'))}>Other · I’ll enter tax myself</button>
    </div>{review.selectedOption==='manual'&&<label>Tax actually charged<MoneyInput aria-label="Tax actually charged" value={bill.tax.amountCents} onChange={amountCents=>onChange({tax:{...bill.tax,type:'fixed',amountCents}})}/></label>}</fieldset>}
    {missing.map(item=><MissingPrice key={item.id} item={item} onChange={patch=>onItemChange(item.id,patch)}/>)}
    {review?.needsTotal&&bill.receiptTotalCents==null&&<p className="notice">What was the final amount charged? Enter it in “Final charged amount” below before sending shares.</p>}
  </section>;
}

function MissingPrice({item,onChange}) {
  const [price,setPrice]=useState(null);
  return <div className="missing-price-question"><label>What was the unit price of {item.name}?<MoneyInput aria-label={`Missing price for ${item.name}`} value={price} optional onChange={setPrice}/></label><div className="action-row"><button type="button" className="button" disabled={price==null||price<0} onClick={()=>onChange({unitPriceCents:price,lineTotalCents:null,priceMissing:false})}>Use this price</button><button type="button" className="text-button" onClick={()=>onChange({unitPriceCents:0,lineTotalCents:0,priceMissing:false})}>This item was free</button></div></div>;
}
