import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { newBill, newRideBill } from '../shared/calculations.js';

test('interactive editor recalculates capped discounts, allocations and receipt reconciliation', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url:'http://localhost:5173/' });
  Object.assign(globalThis, { window:dom.window, document:dom.window.document, HTMLElement:dom.window.HTMLElement, localStorage:dom.window.localStorage, location:dom.window.location, history:dom.window.history, IS_REACT_ACT_ENVIRONMENT:true });
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  dom.window.HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
  const vite = await createServer({ server:{middlewareMode:true,hmr:{port:0}}, appType:'custom' });
  const { render, screen, fireEvent, cleanup, act } = await import('@testing-library/react');
  try {
    const { default:BillEditor } = await vite.ssrLoadModule('/src/BillEditor.jsx');
    const user = { id:'ali',name:'Ali',claimed:true,paymentDetails:'TEST account' }, sara = { id:'sara',name:'Sara',claimed:true,paymentDetails:'' };
    const bill = newBill('ali'); bill.title='Dinner'; bill.participants=['ali','sara']; bill.items=[{id:'food',name:'Dinner plates',quantity:2,unitPriceCents:1500000,eligible:true,allocations:[]}]; bill.discount={...bill.discount,type:'percent',rate:50,eligibleCapCents:2000000}; bill.receiptTotalCents=2000000;
    render(React.createElement(BillEditor,{initial:bill,people:[user,sara],user,onAddFriend(){},onProfile(){},onClose(){},onSaved(){},notify(){}}));
    assert.ok(screen.getByText(/10,000.00 saved/));
    fireEvent.change(screen.getByLabelText('Discount percentage'),{target:{value:'40'}});
    assert.ok(screen.getByText(/8,000.00 saved/));
    assert.ok(screen.getByText(/2,000.00 difference/));
    fireEvent.change(screen.getByLabelText('Discount percentage'),{target:{value:'50'}});
    fireEvent.click(screen.getByRole('button',{name:'Choose who had what'}));
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,true);
    fireEvent.change(screen.getByLabelText('Dinner plates quantity for Ali'),{target:{value:'1'}});
    fireEvent.change(screen.getByLabelText('Dinner plates quantity for Sara'),{target:{value:'1'}});
    assert.ok(screen.getByText('All 2 assigned'));
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,false);
    fireEvent.change(screen.getByLabelText('Dinner plates quantity for Sara'),{target:{value:'2'}});
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,true);
    fireEvent.click(screen.getByRole('button',{name:'Share equally'}));
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,false);
    fireEvent.change(screen.getByLabelText('Final charged amount'),{target:{value:'20050'}});
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,true);
    fireEvent.click(screen.getByRole('button',{name:'Add an explicit adjustment'}));
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,false);
    cleanup();

    const { default:RideEditor } = await vite.ssrLoadModule('/src/RideEditor.jsx');
    render(React.createElement(RideEditor,{initial:newRideBill('ali'),people:[user,sara],user,onAddFriend(){},onProfile(){},onClose(){},onSaved(){}}));
    fireEvent.change(screen.getByLabelText('Total ride fare'),{target:{value:'1200'}});
    assert.match(screen.getByTestId('ride-to-collect').textContent,/0.00/);
    fireEvent.click(screen.getByRole('button',{name:/Sara/}));
    assert.match(screen.getByTestId('ride-to-collect').textContent,/600.00/);
    assert.equal(screen.getByRole('button',{name:'Send ride shares'}).disabled,false);
    fireEvent.change(screen.getByLabelText('Who paid the driver?'),{target:{value:'sara'}});
    assert.equal(screen.getByRole('button',{name:'Send ride shares'}).disabled,true,'unconfigured payer is flagged');
    fireEvent.click(screen.getByRole('button',{name:/Ali/}));
    assert.match(screen.getByTestId('ride-to-collect').textContent,/0.00/);
    cleanup();

    // Verify the onboarding and dashboard use the real profile response.
    const { default:App, BalanceList } = await vite.ssrLoadModule('/src/App.jsx');
    let paid;
    render(React.createElement(BalanceList,{debts:[{id:'outgoing',bill_id:'bill',debtor_id:'ali',creditor_id:'sara',amount:10000,status:'assigned'},{id:'incoming',bill_id:'bill',debtor_id:'sara',creditor_id:'ali',amount:20000,status:'assigned'}],user,person:pid=>pid==='ali'?user:sara,filter:'all',bills:[{id:'bill',title:'Test ride'}],onOpen(){},onPaid:debt=>{paid=debt.id;}}));
    assert.equal(screen.getAllByRole('button',{name:'I’ve paid'}).length,1);
    fireEvent.click(screen.getByRole('button',{name:'I’ve paid'})); assert.equal(paid,'outgoing');
    cleanup();
    const nativeFetch=globalThis.fetch;
    globalThis.fetch=async url=>({ok:true,json:async()=>String(url).endsWith('/register') ? {token:'synthetic-test-session',recoveryCode:'synthetic-recovery',user} : {user,people:[user],bills:[],debts:[],events:[]}});
    try {
      render(React.createElement(App));
      await act(async()=>{});
      fireEvent.change(screen.getByLabelText('Your name'),{target:{value:'Ali'}});
      await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Create my profile'})));
      assert.ok(screen.getByRole('heading',{name:'Hey, Ali.'}));
      assert.ok(screen.getByRole('heading',{name:'Keep your recovery code safe'}));
      assert.equal(localStorage.getItem('tab-together-session'),'synthetic-test-session');
      cleanup();
    } finally { globalThis.fetch=nativeFetch; }
  } finally { cleanup(); await vite.close(); dom.window.close(); }
});
