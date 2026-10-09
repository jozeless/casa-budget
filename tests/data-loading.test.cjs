const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const installMock=require('./helpers/supabase-mock.cjs');const budget=require('../budget.js');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
function mount(seed){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:true,dataset:{},style:{},classList:{toggle(_name,value){node(id).hidden=value;},add(){},remove(){}},setAttribute(){},reset(){}});return nodes.get(id);};
 const buttons=['home','history','data'].map(name=>({dataset:{page:name},setAttribute(){},removeAttribute(){}}));
 const context={Date,Intl,URLSearchParams,Number,String,Map,Set,Math,Promise,JSON,setTimeout,clearTimeout,queueMicrotask,navigator:{},history:{replaceState(){}},location:{hash:'',search:''},document:{getElementById:node,querySelectorAll(selector){return selector==='[data-page]'?buttons:[];}},localStorage:{getItem(){return null;}},window:{CASA_BUDGET:budget,CASA_CONFIG:{supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'sb_publishable_test'}}};
 vm.createContext(context);vm.runInContext('('+installMock.toString()+')('+JSON.stringify(seed)+')',context);vm.runInContext(app,context);
 return {node,buttons,mock:context.window.mock};
}
const current=new Date();const month=budget.monthKey(current);const purchases=count=>Array.from({length:count},(_,index)=>({id:'p'+String(index).padStart(4,'0'),household_id:'test-home',store:'Jumbo',purchased_on:month+'-01',total:1,created_at:'2026-01-01'}));
test('concurrent auth/start routing loads household and purchases only once; tabs do not query',async()=>{
 const ui=mount({purchases:purchases(5)});await settle();assert.equal(ui.mock.calls.filter(c=>c.table==='household_members').length,1);assert.equal(ui.mock.calls.filter(c=>c.table==='purchases').length,1);
 const before=ui.mock.calls.length;for(const button of ui.buttons)button.onclick();assert.equal(ui.mock.calls.length,before);assert.equal(ui.node('screen-heading').textContent,'Data');
});
test('all purchase pages and product pages are loaded; history shows more without more queries',async()=>{
 const rows=purchases(450),items=rows.flatMap(p=>Array.from({length:3},(_,index)=>({id:p.id+'i'+index,purchase_id:p.id,name:'Café',line_total:1,quantity:1})));
 const ui=mount({purchases:rows,items});await settle();await settle();assert.equal(ui.mock.calls.filter(c=>c.table==='purchases').length,3);assert.equal(ui.mock.calls.filter(c=>c.table==='purchase_items').length,9);
 assert.equal(ui.node('purchase-count').textContent,'450 compras');assert.equal((ui.node('purchases-list').innerHTML.match(/data-purchase=/g)||[]).length,50);
 const before=ui.mock.calls.length;ui.node('history-more-btn').onclick();assert.equal((ui.node('purchases-list').innerHTML.match(/data-purchase=/g)||[]).length,100);assert.equal(ui.mock.calls.length,before);
});
test('read failures keep placeholders and error status; do not invent zero spending',async()=>{
 const ui=mount({failRead:true});await settle();assert.match(ui.node('data-status').textContent,/No se pudieron/);assert.equal(ui.node('spent').textContent,'—');assert.equal(ui.node('app-nav').hidden,false);
 ui.mock.seed.failRead=false;await ui.node('refresh-data-btn').onclick();assert.match(ui.node('spent').textContent,/0/);assert.equal(ui.node('data-status').textContent,'Compras actualizadas');
});
