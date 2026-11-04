import React, {useState} from 'react';
import { MoneyInput } from './ui.jsx';

export default function ReceiptQuestions({bill,onChange,onItemChange}) {
  const missing=bill.items.filter(i=>i.priceMissing);
  if(!missing.length)return null;
  return <section className="card receipt-questions" aria-label="Receipt questions">
    <h2>A quick check</h2><p className="muted">Help us finish the details the receipt couldn’t confirm.</p>
    {missing.map(item=><MissingPrice key={item.id} item={item} onChange={patch=>onItemChange(item.id,patch)}/>)}
  </section>;
}

function MissingPrice({item,onChange}) {
  const [price,setPrice]=useState(null);
  return <div className="missing-price-question"><label>What was the unit price of {item.name}?<MoneyInput aria-label={`Missing price for ${item.name}`} value={price} optional onChange={setPrice}/></label><div className="action-row"><button type="button" className="button" disabled={price==null||price<0} onClick={()=>onChange({unitPriceCents:price,lineTotalCents:null,priceMissing:false})}>Use this price</button><button type="button" className="text-button" onClick={()=>onChange({unitPriceCents:0,lineTotalCents:0,priceMissing:false})}>This item was free</button></div></div>;
}
