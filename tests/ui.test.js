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
  const vite = await createServer({ server:{middlewareMode:true,hmr:false}, appType:'custom' });
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
    fireEvent.click(screen.getByRole('button',{name:'Add one Dinner plates to Ali'}));
    fireEvent.click(screen.getByRole('button',{name:'Add one Dinner plates to Sara'}));
    assert.ok(screen.getByText('All 2 assigned'));
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,false);
    fireEvent.click(screen.getByRole('button',{name:'Edit assignments for Dinner plates'}));
    fireEvent.change(screen.getByLabelText('Dinner plates quantity for Sara'),{target:{value:'2'}});
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,true);
    fireEvent.click(screen.getByRole('button',{name:'Share Dinner plates'}));
    fireEvent.click(screen.getByRole('button',{name:'Share equally'}));
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,false);
    fireEvent.click(screen.getByRole('button',{name:'Edit assignments for Dinner plates'}));
    fireEvent.click(screen.getByRole('button',{name:'Remove one Dinner plates from Sara'}));
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,true);
    fireEvent.click(screen.getByRole('button',{name:'Add one Dinner plates to Sara'}));
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,false);
    dom.window.confirm = () => true;
    fireEvent.click(screen.getByRole('button',{name:'Split all items equally'}));
    fireEvent.click(screen.getByRole('button',{name:'Edit assignments for Dinner plates'}));
    assert.equal(screen.getByLabelText('Dinner plates quantity for Sara').value,'1');
    fireEvent.change(screen.getByLabelText('Final charged amount'),{target:{value:'20050'}});
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,true);
    fireEvent.click(screen.getByRole('button',{name:'Add an explicit adjustment'}));
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,false);
    cleanup();

    // Manual entry works without scanning; payer contributions immediately recalculate.
    const manual={...bill,entryMode:'manual',receiptTotalCents:null};
    manual.items[0].allocations=[{personId:'ali',quantity:1},{personId:'sara',quantity:1}];
    render(React.createElement(BillEditor,{initial:manual,people:[user,{...sara,paymentDetails:'TEST Sara'}],user,onAddFriend(){},onProfile(){},onClose(){},onSaved(){},notify(){}}));
    assert.equal(screen.queryByRole('button',{name:'Scan',exact:true}),null);
    fireEvent.click(screen.getByRole('button',{name:'Add item'}));
    assert.ok(screen.getByLabelText('Item 2 name'));
    cleanup();
    render(React.createElement(BillEditor,{initial:{...bill,entryMode:'manual'},people:[user,{...sara,paymentDetails:'TEST Sara'}],user,onAddFriend(){},onProfile(){},onClose(){},onSaved(){},notify(){}}));
    fireEvent.click(screen.getByRole('button',{name:'Choose who had what'}));
    fireEvent.click(screen.getByRole('button',{name:'Split all items equally'}));
    fireEvent.click(screen.getByRole('button',{name:'Multiple people'}));
    fireEvent.change(screen.getByLabelText('Payer 1 amount'),{target:{value:'12000'}});
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,true);
    fireEvent.click(screen.getByRole('button',{name:'Add another payer'}));
    assert.equal(screen.getByLabelText('Payer 2 amount').value,'8000');
    assert.ok(screen.getByText('Sara → Ali'));
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,false);
    fireEvent.click(screen.getByRole('button',{name:'One person'}));
    assert.equal(screen.queryByLabelText('Payer 2 amount'),null);
    assert.equal(screen.getByRole('button',{name:'Send everyone their share'}).disabled,false);
    cleanup();

    const {default:BillDetails}=await vite.ssrLoadModule('/src/BillDetails.jsx');
    const hamza={id:'hamza',name:'Hamza',claimed:true,paymentDetails:''};
    const multi=newRideBill('ali'); Object.assign(multi,{id:'multi',status:'published',creatorId:'ali',participants:['ali','sara','hamza'],fareCents:90000,payments:[{personId:'ali',amountCents:50000},{personId:'sara',amountCents:40000}]});
    const debts=[{id:'first',bill_id:'multi',debtor_id:'hamza',creditor_id:'ali',amount:20000,status:'assigned'},{id:'second',bill_id:'multi',debtor_id:'hamza',creditor_id:'sara',amount:10000,status:'marked_paid'}];
    let actionDebt;
    render(React.createElement(BillDetails,{bill:multi,debts,person:pid=>[user,sara,hamza].find(p=>p.id===pid),user:hamza,onBack(){},onEdit(){},onCopy(){},onAction:d=>{actionDebt=d.id;}}));
    assert.ok(screen.getByRole('heading',{name:'Pay Ali'}));
    assert.ok(screen.getByRole('heading',{name:'Pay Sara'}));
    assert.equal(screen.getAllByRole('button',{name:'I’ve paid'}).length,1);
    fireEvent.click(screen.getByRole('button',{name:'I’ve paid'})); assert.equal(actionDebt,'first');
    assert.ok(screen.getByText(/Pending approval from Sara/));
    cleanup();

    // Exercise the full file -> Gemini -> editable fields flow without any real API.
    const savedFetch=globalThis.fetch, savedBitmap=globalThis.createImageBitmap;
    const savedContext=dom.window.HTMLCanvasElement.prototype.getContext, savedBlob=dom.window.HTMLCanvasElement.prototype.toBlob;
    globalThis.createImageBitmap=async()=>({width:100,height:100,close(){}});
    dom.window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){}});
    dom.window.HTMLCanvasElement.prototype.toBlob=callback=>callback(new Blob(['synthetic'],{type:'image/jpeg'}));
    globalThis.fetch=async()=>({ok:true,json:async()=>({source:'gemini',receipt:{title:'Scanned dinner',items:[{id:'scan',name:'Dinner',quantity:2,unitPriceCents:1500000,lineTotalCents:3000000,eligible:true,uncertain:false,allocations:[]}],charges:{discountCents:null,discountRate:50,eligibleCapCents:2000000,maxDiscountCents:null,taxCents:10000,taxRate:15,taxBasis:null,deliveryCents:null,serviceCents:null,tipCents:null},receiptTotalCents:2010000,warnings:[]}})});
    try {
      const scanning=newBill('ali'); scanning.adjustmentCents=5000; scanning.adjustmentReason='Old receipt adjustment';
      const {container}=render(React.createElement(BillEditor,{initial:scanning,people:[user,sara],user,onAddFriend(){},onProfile(){},onClose(){},onSaved(){},notify(){}}));
      assert.equal(screen.getByLabelText('Keep photo on this device').checked,false);
      await act(async()=>fireEvent.change(container.querySelector('input[type=file]'),{target:{files:[new dom.window.File(['synthetic'],'receipt.jpg',{type:'image/jpeg'})]}}));
      assert.ok(screen.getByRole('heading',{name:'Scan this receipt?'}));
      await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Scan receipt'})));
      assert.ok(screen.getByText('Ready to review'));
      assert.equal(screen.queryByText(/Read with Gemini|GPT-6|on-device OCR/),null);
      assert.equal(screen.getByLabelText('Item 1 quantity').value,'2');
      assert.equal(screen.getByLabelText('Discount percentage').value,'50');
      assert.equal(screen.getByLabelText('Discount eligible amount limit').value,'20000');
      assert.ok(screen.getByText('Matches your receipt'),'exact printed tax wins over percentage and old adjustment is cleared');
      fireEvent.change(screen.getByLabelText('Item 1 name'),{target:{value:'Corrected dinner'}});
      fireEvent.change(screen.getByLabelText('Item 1 quantity'),{target:{value:'3'}});
      fireEvent.change(screen.getByLabelText('Item 1 unit price'),{target:{value:'10000'}});
      assert.equal(screen.getByLabelText('Item 1 name').value,'Corrected dinner');
      assert.ok(screen.getByText('Matches your receipt'),'editing scanned quantity and price recalculates');
      fireEvent.change(screen.getByLabelText('Discount percentage'),{target:{value:'40'}});
      assert.ok(screen.getByText(/difference/));
      fireEvent.change(screen.getByLabelText('Final charged amount'),{target:{value:'22100'}});
      assert.ok(screen.getByText('Matches your receipt'));
      fireEvent.change(screen.getByLabelText('Tax amount'),{target:{value:'200'}});
      assert.ok(screen.getByText(/difference/),'scanned tax remains editable');
      fireEvent.change(screen.getByLabelText('Final charged amount'),{target:{value:'22200'}});
      assert.ok(screen.getByText('Matches your receipt'));
      fireEvent.click(screen.getByLabelText('Keep photo on this device'));
      assert.equal(screen.getByLabelText('Keep photo on this device').checked,true);
    } finally {
      cleanup(); globalThis.fetch=savedFetch;
      if(savedBitmap) globalThis.createImageBitmap=savedBitmap; else delete globalThis.createImageBitmap;
      dom.window.HTMLCanvasElement.prototype.getContext=savedContext; dom.window.HTMLCanvasElement.prototype.toBlob=savedBlob;
    }

    const {default:ItemAssignments} = await vite.ssrLoadModule('/src/ItemAssignments.jsx');
    function AssignmentHarness({quantity}) {
      const [item,setItem]=React.useState({id:'drink',name:'Cola',quantity,unitPriceCents:10000,allocations:[]});
      return React.createElement(ItemAssignments,{item,participants:[user,sara],user,onChange:patch=>setItem(current=>({...current,...(typeof patch==='function'?patch(current):patch)}))});
    }
    render(React.createElement(AssignmentHarness,{quantity:6}));
    const addAli=screen.getByRole('button',{name:'Add one Cola to Ali'});
    act(()=>{ for(let i=0;i<8;i++) fireEvent.click(addAli); });
    assert.equal(screen.getByLabelText('Cola quantity for Ali').value,'6','batched taps never exceed quantity');
    fireEvent.click(screen.getByRole('button',{name:'Remove one Cola from Ali'}));
    fireEvent.click(screen.getByRole('button',{name:'Add one Cola to Sara'}));
    assert.equal(screen.getByLabelText('Cola quantity for Sara').value,'1');
    assert.ok(screen.getByText('All 6 assigned'));
    cleanup();
    render(React.createElement(AssignmentHarness,{quantity:1}));
    fireEvent.click(screen.getByRole('button',{name:'Assign Cola to Ali'}));
    fireEvent.click(screen.getByRole('button',{name:'Assign Cola to Sara'}));
    assert.equal(screen.getByLabelText('Cola quantity for Ali').value,'0');
    assert.equal(screen.getByLabelText('Cola quantity for Sara').value,'1');
    fireEvent.click(screen.getByRole('button',{name:'Share Cola'}));
    fireEvent.click(screen.getByRole('button',{name:'You'}));
    fireEvent.click(screen.getByRole('button',{name:'Split between 2'}));
    assert.equal(screen.getByLabelText('Cola quantity for Sara').value,'0.5');
    assert.equal(screen.getByLabelText('Cola quantity for Ali').value,'0.5');
    cleanup();

    const { default:RideEditor } = await vite.ssrLoadModule('/src/RideEditor.jsx');
    render(React.createElement(RideEditor,{initial:newRideBill('ali'),people:[user,sara],user,onAddFriend(){},onProfile(){},onClose(){},onSaved(){}}));
    fireEvent.change(screen.getByLabelText('Total ride fare'),{target:{value:'1200'}});
    assert.match(screen.getByTestId('ride-to-collect').textContent,/0.00/);
    fireEvent.click(screen.getByRole('button',{name:/Sara/}));
    assert.match(screen.getByTestId('ride-to-collect').textContent,/600.00/);
    assert.equal(screen.getByRole('button',{name:'Send ride shares'}).disabled,false);
    fireEvent.change(screen.getByLabelText('Who paid the original bill?'),{target:{value:'sara'}});
    assert.equal(screen.getByRole('button',{name:'Send ride shares'}).disabled,true,'unconfigured payer is flagged');
    fireEvent.click(screen.getByRole('button',{name:/Ali/}));
    assert.match(screen.getByTestId('ride-to-collect').textContent,/0.00/);
    cleanup();
    const { default:HomeOverview } = await vite.ssrLoadModule('/src/HomeOverview.jsx');
    let selectedAction;
    const waiting={id:'pending',bill_id:'bill',debtor_id:'sara',creditor_id:'ali',amount:20000,status:'marked_paid'};
    render(React.createElement(HomeOverview,{debts:[waiting],user,person:pid=>pid==='ali'?user:sara,bills:[{id:'bill',title:'Test ride'}],onOpen(){},onAction:(d,a)=>selectedAction=a,onCreate(){},onBills(){}}));
    assert.ok(screen.getByRole('heading',{name:'Did these payments arrive?'}));
    fireEvent.click(screen.getByRole('button',{name:'Confirm received'}));
    assert.equal(selectedAction,'confirm');
    assert.ok(screen.getByRole('heading',{name:'Nothing to pay'}));
    cleanup();
    const { PaymentModal } = await vite.ssrLoadModule('/src/ui.jsx');
    let submitted = false;
    render(React.createElement(PaymentModal,{modal:{debt:waiting,action:'confirm'},person:pid=>pid==='ali'?user:sara,onClose(){},onSubmit:async()=>{submitted=true;}}));
    assert.equal(submitted,false,'opening confirmation never changes financial status');
    assert.ok(screen.getByText(/Check your bank, wallet or cash/));
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Yes, I received the money'})));
    assert.equal(submitted,true);
    cleanup();

    // Group bills by friend while excluding pending amounts from money to pay.
    const partiallyPaid={id:'partial',bill_id:'meal1',debtor_id:'ali',creditor_id:'sara',amount:120000,paid_amount:20000,pending_amount:50000,status:'marked_paid'};
    const anotherDebt={id:'another',bill_id:'meal2',debtor_id:'ali',creditor_id:'sara',amount:30000,status:'assigned'};
    const report={id:'claim',debtor_id:'ali',creditor_id:'sara',amount:50000,status:'pending',allocations:[{debtId:'partial',billId:'meal1',amount:50000}]};
    const paymentBills=[{id:'meal1',title:'Dinner'},{id:'meal2',title:'Ride home'}];
    let grouped;
    render(React.createElement(HomeOverview,{debts:[partiallyPaid,anotherDebt],repayments:[report],user,person:pid=>pid==='ali'?user:sara,bills:paymentBills,onOpen(){},onAction:(d)=>grouped=d,onCreate(){},onBills(){}}));
    assert.match(screen.getByRole('button',{name:/You owe.*800.00/}).textContent,/excludes pending/);
    assert.match(screen.getByRole('button',{name:/Awaiting confirmation — don’t pay again/}).textContent,/500.00/);
    assert.equal(screen.getAllByRole('button',{name:'I’ve paid'}).length,1,'friend gets one button across bills');
    fireEvent.click(screen.getByRole('button',{name:'I’ve paid'}));assert.equal(grouped.debts.length,2);cleanup();
    let paymentBody;
    render(React.createElement(PaymentModal,{modal:{debt:grouped,action:'paid'},person:pid=>pid==='ali'?user:sara,onClose(){},onSubmit:async body=>{paymentBody=body;}}));
    assert.equal(screen.getByLabelText('Amount you paid').value,'800');
    fireEvent.click(screen.getByRole('checkbox',{name:/Ride home/}));assert.equal(screen.getByLabelText('Amount you paid').value,'500');
    fireEvent.change(screen.getByLabelText('Amount you paid'),{target:{value:'100'}});
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'I’ve paid — notify Sara'})));
    assert.equal(paymentBody.amountCents,10000);assert.deepEqual(paymentBody.debtIds,['partial']);assert.ok(paymentBody.requestId);cleanup();

    // Explicit receipt questions, including a price that must not vanish mid-entry.
    const choices={...bill,entryMode:'manual',discount:newBill('ali').discount,receiptTotalCents:null,receiptReview:{needsTotal:true,selectedOption:null,options:[{label:'Card',taxCents:150000,taxRate:5,taxBasis:null,receiptTotalCents:3150000},{label:'Cash',taxCents:480000,taxRate:16,taxBasis:null,receiptTotalCents:3480000}]}};
    render(React.createElement(BillEditor,{initial:choices,people:[user,sara],user,onAddFriend(){},onProfile(){},onClose(){},onSaved(){},notify(){}}));
    fireEvent.click(screen.getByRole('button',{name:/Card.*5% tax/}));assert.equal(screen.getByLabelText('Final charged amount').value,'31500');
    fireEvent.click(screen.getByRole('button',{name:/Cash.*16% tax/}));assert.equal(screen.getByLabelText('Final charged amount').value,'34800');
    cleanup();
    const unknown={...choices,receiptReview:null,items:[{...choices.items[0],name:'Pizza',unitPriceCents:0,lineTotalCents:null,priceMissing:true,allocations:[]}]};
    render(React.createElement(BillEditor,{initial:unknown,people:[user,sara],user,onAddFriend(){},onProfile(){},onClose(){},onSaved(){},notify(){}}));
    fireEvent.change(screen.getByLabelText('Missing price for Pizza'),{target:{value:'500'}});assert.ok(screen.getByLabelText('Missing price for Pizza'));
    fireEvent.click(screen.getByRole('button',{name:'Use this price'}));assert.equal(screen.getByLabelText('Item 1 unit price').value,'500');assert.equal(screen.queryByLabelText('Missing price for Pizza'),null);
    // Completing an item collapses it. Undo restores assignments, not later prices.
    fireEvent.click(screen.getByRole('button',{name:'Choose who had what'}));
    fireEvent.click(screen.getByLabelText('Only show unassigned items'));
    fireEvent.click(screen.getByRole('button',{name:'Add one Pizza to Ali'}));
    fireEvent.click(screen.getByRole('button',{name:'Add one Pizza to Sara'}));
    assert.equal(screen.queryByRole('button',{name:'Add one Pizza to Ali'}),null);
    fireEvent.click(screen.getByRole('button',{name:'1 Review the bill'}));
    fireEvent.change(screen.getByLabelText('Item 1 unit price'),{target:{value:'600'}});
    fireEvent.click(screen.getByRole('button',{name:'Choose who had what'}));
    fireEvent.click(screen.getByRole('button',{name:'Undo assignment'}));
    assert.ok(screen.getByRole('button',{name:'Add one Pizza to Sara'}));
    fireEvent.click(screen.getByRole('button',{name:'1 Review the bill'}));
    assert.equal(screen.getByLabelText('Item 1 unit price').value,'600','Undo must preserve price edits');
    await act(async()=>{window.dispatchEvent(new window.Event('pagehide'));});
    const drafts=await vite.ssrLoadModule('/src/drafts.js');
    assert.ok(drafts.readDrafts(user.id).some(d=>d.bill.items[0]?.unitPriceCents===60000));
    cleanup();

    // A saved/published draft must not reappear when its editor unmounts.
    function DraftHarness(){const b=React.useMemo(()=>({...newBill('hook-user'),title:'Draft hook'}),[]);const auto=drafts.useDraftAutosave('hook-user',b);return React.createElement('button',{onClick:auto.clear},auto.message);}
    render(React.createElement(DraftHarness));
    await act(async()=>{await new Promise(r=>setTimeout(r,350));});
    assert.equal(drafts.readDrafts('hook-user').length,1);
    fireEvent.click(screen.getByRole('button',{name:'Draft saved on this device'}));cleanup();
    assert.equal(drafts.readDrafts('hook-user').length,0);
    localStorage.clear();

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
      fireEvent.change(screen.getByLabelText('Username'),{target:{value:'Ali_123'}});
      fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'ali@example.test'}});
      await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Create my profile'})));
      assert.ok(screen.getByRole('heading',{name:'Hey, Ali.'}));
      assert.ok(screen.getByRole('heading',{name:'Keep your recovery code safe'}));
      assert.equal(localStorage.getItem('tab-together-session'),'synthetic-test-session');
      cleanup();
    } finally { globalThis.fetch=nativeFetch; }
  } finally { cleanup(); await vite.close(); dom.window.close(); }
});
