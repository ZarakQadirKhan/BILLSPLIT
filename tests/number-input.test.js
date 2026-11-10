import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

test('numeric fields allow blank replacements and decimals while keeping calculations and external updates in sync',async()=>{
  const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost:5173/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
  const {render,screen,fireEvent,cleanup}=await import('@testing-library/react');
  try {
    const {MoneyInput,NumberInput}=await vite.ssrLoadModule('/src/ui.jsx');
    let latest;
    function Harness({money=true,optional=false,initial=0}){
      const [value,setValue]=React.useState(initial);latest=value;
      return React.createElement(React.Fragment,null,
        React.createElement(money?MoneyInput:NumberInput,{'aria-label':'Number',value,...(money?{optional,min:-1000}:{}),onChange:money?setValue:e=>setValue(Number(e.target.value))}),
        React.createElement('button',{onClick:()=>setValue(money?12345:3)},'External update'),
        React.createElement('button',{onClick:()=>setValue(0)},'Reset'));
    }
    const change=value=>fireEvent.change(screen.getByLabelText('Number'),{target:{value}});
    for(const money of [true,false]){
      render(React.createElement(Harness,{money}));
      const input=screen.getByLabelText('Number');
      change('');assert.equal(input.value,'','zero can be cleared');assert.equal(latest,0);
      change('2');assert.equal(input.value,'2');assert.equal(latest,money?200:2);
      change('');assert.equal(input.value,'','nonzero can also be cleared');
      change('0');change('0.0');assert.equal(input.value,'0.0','trailing decimal zero stays editable');
      change('0.05');assert.equal(latest,money?5:0.05);
      change('12.50');assert.equal(input.value,'12.50');assert.equal(latest,money?1250:12.5);
      change('');fireEvent.click(screen.getByText('External update'));assert.equal(input.value,money?'123.45':'3');
      fireEvent.click(screen.getByText('Reset'));assert.equal(input.value,'0');
      change('');fireEvent.blur(input);assert.equal(input.value,'0','empty non-optional value normalizes after editing');
      cleanup();
    }
    render(React.createElement(Harness,{optional:true,initial:null}));
    const optional=screen.getByLabelText('Number');
    change('0');assert.equal(latest,0);
    change('');assert.equal(latest,null,'optional empty and explicit zero stay distinct');
    fireEvent.blur(optional);assert.equal(optional.value,'');
    change('-2.50');assert.equal(latest,-250);assert.equal(optional.value,'-2.50');
    change('1.235');assert.equal(latest,124);assert.equal(optional.value,'1.235','money rounding does not interrupt editing');
    fireEvent.blur(optional);assert.equal(optional.value,'1.24');
  } finally {cleanup();await vite.close();dom.window.close();}
});
