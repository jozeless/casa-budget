const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const installMock=require('./helpers/supabase-mock.cjs');const budget=require('../budget.js');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
function mount(seed,initialDate){
 let clock=initialDate?new Date(initialDate).getTime():Date.now();
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const events={},timers=[],storage=new Map(),rows=[];
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:true,dataset:{},style:{},classList:{toggle(_name,value){node(id).hidden=value;},add(){},remove(){}},setAttribute(){},reset(){},close(){this.open=false;},showModal(){this.open=true;}});return nodes.get(id);};
 const buttons=['home','history','data'].map(name=>({dataset:{page:name},setAttribute(){},removeAttribute(){}}));
 const context={Date:ClockDate,confirm(){return true;},Intl,URLSearchParams,Number,String,Map,Set,Math,Promise,JSON,setTimeout,clearTimeout,queueMicrotask,navigator:{},history:{replaceState(){}},location:{hash:'',search:''},document:{addEventListener(name,fn){events[name]=fn;},getElementById:node,querySelectorAll(selector){return selector==='[data-page]'?buttons:selector==='#items-container .item-row'?rows:[];}},localStorage:{getItem(key){return storage.get(key)||null;},setItem(key,value){storage.set(key,value);},removeItem(key){storage.delete(key);}},window:{crypto:require('node:crypto').webcrypto,setTimeout(fn,delay){timers.push({fn,delay});return timers.length;},clearTimeout(){},addEventListener(name,fn){events[name]=fn;},CASA_BUDGET:budget,CASA_CONFIG:{supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'sb_publishable_test'}}};
 vm.createContext(context);vm.runInContext('('+installMock.toString()+')('+JSON.stringify(seed)+')',context);vm.runInContext(app,context);
 return {node,buttons,mock:context.window.mock,events,timers,rows,reload(){vm.runInContext(app,context);},setDate(date){clock=new Date(date).getTime();}};
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

const fixture=(id,date,total)=>({id,household_id:'test-home',store:'Jumbo',purchased_on:date,total,created_at:date+'T12:00:00Z'});
for(const [name,from,to] of [
 ['day','2026-10-09T12:00:00','2026-10-10T00:00:01'],
 ['Sunday to Monday','2026-10-11T12:00:00','2026-10-12T00:00:01'],
 ['month end','2026-10-31T12:00:00','2026-11-01T00:00:01']
])test('calendar updates automatically at '+name+' without queries',async()=>{
 const rows=[fixture('oct','2026-10-01',100),fixture('nov','2026-11-01',20)];
 const ui=mount({budget:200,purchases:rows},from);await settle();
 const calls=ui.mock.calls.length;ui.setDate(to);ui.timers.at(-1).fn();
 const expected=budget.weekly(200,rows,new Date(to));
 assert.match(ui.node('weekly-amount').textContent,new RegExp(String(expected.amount/100).replace('.',',')));
 assert.match(ui.node('weekly-period').textContent,new RegExp(expected.daysThisWeek+' días'));
 assert.match(ui.node('remaining').textContent,name==='month end'?/180/:/100/);
 assert.match(ui.node('period-heading').textContent,name==='month end'?/noviembre/:/octubre/);
 assert.equal(ui.mock.calls.length,calls);
});
for(const event of ['visibilitychange','pageshow','focus'])test('resume via '+event+' preserves manually selected report months',async()=>{
 const ui=mount({budget:200,purchases:[fixture('oct','2026-10-01',100)]},'2026-10-31T12:00:00');await settle();
 ui.node('history-month').value='2026-09';ui.node('history-month').onchange();
 ui.node('data-month').value='2026-09';ui.node('data-month').onchange();
 const calls=ui.mock.calls.length;ui.setDate('2026-11-01T12:00:00');ui.events[event]();
 assert.match(ui.node('period-heading').textContent,/noviembre/);
 assert.equal(ui.node('history-month').value,'2026-09');assert.equal(ui.node('data-month').value,'2026-09');assert.equal(ui.mock.calls.length,calls);
});
test('automatic report months follow rollover and navigation also checks calendar',async()=>{
 const ui=mount({purchases:[]},'2026-10-31T12:00:00');await settle();ui.setDate('2026-11-01T12:00:00');ui.buttons[1].onclick();
 assert.equal(ui.node('history-month').value,'2026-11');assert.equal(ui.node('data-month').value,'2026-11');
});
test('refresh reads another member budget and commits only a complete snapshot',async()=>{
 const ui=mount({budget:100,purchases:[fixture('one',month+'-01',20)]});await settle();
 ui.mock.data.household.monthly_budget=200;assert.match(ui.node('budget').textContent,/100/);
 await ui.node('refresh-data-btn').onclick();assert.match(ui.node('budget').textContent,/200/);assert.match(ui.node('remaining').textContent,/180/);
 ui.mock.data.household.monthly_budget=300;ui.mock.seed.failRead=true;await ui.node('refresh-data-btn').onclick();
 assert.match(ui.node('budget').textContent,/200/);assert.match(ui.node('data-status').textContent,/desactualizada/);
 ui.mock.seed.failRead=false;ui.mock.seed.failHousehold=true;await ui.node('refresh-data-btn').onclick();assert.match(ui.node('budget').textContent,/200/);assert.match(ui.node('data-status').textContent,/desactualizada/);
 ui.mock.seed.failHousehold=false;await ui.node('refresh-data-btn').onclick();assert.match(ui.node('budget').textContent,/300/);
});
test('successful save followed by failed read keeps purchase in all views and confirms saved',async()=>{
 const ui=mount({budget:100,purchases:[fixture('one',month+'-01',20)]});await settle();
 ui.node('purchase-store').value='Aldi';ui.node('purchase-date').value=month+'-02';ui.node('purchase-total').value='10';ui.mock.seed.failReadAfterWrite=true;
 await ui.node('purchase-form').onsubmit({preventDefault(){}});
 assert.equal(ui.mock.data.purchases.length,2);assert.match(ui.node('spent').textContent,/30/);assert.match(ui.node('purchases-list').innerHTML,/Aldi/);assert.match(ui.node('store-report').innerHTML,/Aldi/);
 assert.match(ui.node('toast').textContent,/Compra guardada/);assert.match(ui.node('toast').textContent,/no repitas/);assert.match(ui.node('data-status').textContent,/desactualizada/);
 ui.mock.seed.failRead=false;ui.mock.seed.failReadAfterWrite=false;await ui.node('refresh-data-btn').onclick();assert.equal(ui.mock.data.purchases.length,2);assert.match(ui.node('spent').textContent,/30/);
});
test('successful deletion followed by failed read removes purchase from all views',async()=>{
 const ui=mount({budget:100,purchases:[fixture('one',month+'-01',20)]});await settle();
 ui.node('purchases-list').onclick({target:{closest(){return {dataset:{purchase:'one'}};}}});ui.mock.seed.failRead=true;
 await ui.node('delete-purchase').onclick();assert.equal(ui.mock.data.purchases.length,0);assert.match(ui.node('spent').textContent,/0,00/);assert.doesNotMatch(ui.node('purchases-list').innerHTML,/data-purchase=/);assert.match(ui.node('store-report').innerHTML,/No hay/);assert.match(ui.node('toast').textContent,/Compra eliminada/);assert.match(ui.node('data-status').textContent,/desactualizada/);
});
test('failed write is not reported as saved and duplicate submissions while saving are ignored',async()=>{
 const ui=mount({purchases:[],delay:2});await settle();ui.node('purchase-store').value='Aldi';ui.node('purchase-date').value=month+'-02';ui.node('purchase-total').value='10';ui.mock.seed.failWrite=true;
 await ui.node('purchase-form').onsubmit({preventDefault(){}});assert.equal(ui.mock.data.purchases.length,0);assert.match(ui.node('toast').textContent,/Simulated write failure/);
 ui.mock.seed.failWrite=false;const first=ui.node('purchase-form').onsubmit({preventDefault(){}});await ui.node('purchase-form').onsubmit({preventDefault(){}});await first;assert.equal(ui.mock.data.purchases.length,1);
});

test('manual all-month history survives rollover',async()=>{
 const ui=mount({purchases:[]},'2026-10-31T12:00:00');await settle();ui.node('history-month').value='';ui.node('history-month').onchange();ui.setDate('2026-11-01T12:00:00');ui.events.focus();assert.equal(ui.node('history-month').value,'');
});
test('failed deletion preserves purchase and does not confirm success',async()=>{
 const ui=mount({purchases:[fixture('one',month+'-01',20)]});await settle();ui.node('purchases-list').onclick({target:{closest(){return {dataset:{purchase:'one'}};}}});ui.mock.seed.failWrite=true;await ui.node('delete-purchase').onclick();assert.equal(ui.mock.data.purchases.length,1);assert.match(ui.node('purchases-list').innerHTML,/data-purchase=/);assert.match(ui.node('toast').textContent,/Simulated write failure/);assert.equal(ui.node('delete-purchase').disabled,false);
});
test('late successful write after logout cannot populate a different session dashboard',async()=>{
 const ui=mount({purchases:[],delay:5});await settle();ui.node('purchase-store').value='Aldi';ui.node('purchase-date').value=month+'-02';ui.node('purchase-total').value='10';
 const saving=ui.node('purchase-form').onsubmit({preventDefault(){}});ui.mock.emit('SIGNED_OUT',null);await saving;assert.equal(ui.node('spent').textContent,'—');assert.equal(ui.node('purchases-list').innerHTML,'');assert.equal(ui.mock.data.purchases.length,1);
});

function form(ui,storeName='Aldi',total='10',date=month+'-02'){
 ui.node('purchase-store').value=storeName;ui.node('purchase-date').value=date;ui.node('purchase-total').value=total;
}
const submit=ui=>ui.node('purchase-form').onsubmit({preventDefault(){}});
test('editing keeps purchase identity, changes month and updates shared reports',async()=>{
 const ui=mount({budget:100,purchases:[fixture('one',month+'-01',20)]});await settle();
 ui.node('purchases-list').onclick({target:{closest(){return {dataset:{purchase:'one'}};}}});ui.node('edit-purchase').onclick();
 const otherMonth=budget.monthKey(new Date(current.getFullYear(),current.getMonth()-1,1));form(ui,'Lidl','30',otherMonth+'-01');await submit(ui);
 assert.equal(ui.mock.data.purchases.length,1);assert.equal(ui.mock.data.purchases[0].id,'one');assert.equal(ui.mock.data.purchases[0].total,30);assert.match(ui.node('spent').textContent,/0,00/);assert.match(ui.node('remaining').textContent,/100/);
 ui.node('data-month').value=otherMonth;ui.node('data-month').onchange();assert.match(ui.node('store-report').innerHTML,/Lidl/);assert.match(ui.node('store-report').innerHTML,/30/);
});
test('stale editing revision rejects overwrite and leaves existing purchase intact',async()=>{
 const ui=mount({purchases:[fixture('one',month+'-01',20)]});await settle();ui.node('purchases-list').onclick({target:{closest(){return {dataset:{purchase:'one'}};}}});ui.node('edit-purchase').onclick();ui.mock.data.purchases[0].revision++;form(ui,'Aldi','30');await submit(ui);
 assert.equal(ui.mock.data.purchases[0].total,20);assert.match(ui.node('toast').textContent,/compra cambió/);assert.equal(ui.mock.data.purchases.length,1);
});
test('duplicate warning supports cancel and save anyway without blocking legitimate purchases',async()=>{
 const ui=mount({purchases:[fixture('one',month+'-02',10)]});await settle();form(ui,'  JUMBO  ');
 let saving=submit(ui);await settle();assert.equal(ui.node('duplicate-dialog').open,true);ui.node('duplicate-cancel').onclick();await saving;assert.equal(ui.mock.data.purchases.length,1);
 saving=submit(ui);await settle();ui.node('duplicate-save').onclick();await saving;assert.equal(ui.mock.data.purchases.length,2);
});
test('lost write response retries the same operation after restarting the app',async()=>{
 const ui=mount({purchases:[],loseResponse:true});await settle();form(ui);await submit(ui);assert.equal(ui.mock.data.purchases.length,1);assert.match(ui.node('toast').textContent,/Guardado pendiente/);
 ui.reload();await settle();ui.node('new-purchase-btn').onclick();await submit(ui);assert.equal(ui.mock.data.purchases.length,1);assert.match(ui.node('toast').textContent,/Compra guardada/);
});
test('uncertain pending operation cannot silently become a different purchase',async()=>{
 const ui=mount({purchases:[],loseResponse:true});await settle();form(ui);await submit(ui);ui.node('purchase-total').value='15';await submit(ui);assert.equal(ui.mock.data.purchases.length,1);assert.match(ui.node('toast').textContent,/datos originales/);
});
test('mismatched line totals fail before any write',async()=>{
 const ui=mount({purchases:[]});await settle();form(ui);ui.rows.push({querySelector(selector){return {value:selector==='.item-name'?'Milk':selector==='.item-qty'?'1':'9'};}});await submit(ui);assert.equal(ui.mock.data.purchases.length,0);assert.match(ui.node('toast').textContent,/suma de productos/);
});
test('product history loads more than one page, initially selected month, then all months',async()=>{
 const old=budget.monthKey(new Date(current.getFullYear(),current.getMonth()-1,1));
 const ps=Array.from({length:250},(_,i)=>fixture('p'+i,i<100?month+'-01':old+'-01',1));
 const ui=mount({purchases:ps,items:ps.map((p,i)=>({id:'i'+i,purchase_id:p.id,name:i%2?' Milk ':'MILK',quantity:1,line_total:1}))});await settle();await settle();
 ui.node('product-report').onclick({target:{closest(){return {dataset:{product:'milk'}};}}});await settle();assert.equal(ui.mock.calls.filter(c=>c.operation==='casa_product_history').length,2);assert.match(ui.node('product-summary').textContent,/100 compras/);
 ui.node('product-month').value='';ui.node('product-month').onchange();assert.match(ui.node('product-summary').textContent,/250 compras/);assert.equal((ui.node('product-history').innerHTML.match(/data-original=/g)||[]).length,250);
 ui.node('product-month').value=old;ui.node('product-month').onchange();assert.match(ui.node('product-summary').textContent,/150 compras/);
});

test('missing migration keeps phase one data readable and explains unavailable writes',async()=>{
 const ui=mount({noMigration:true,purchases:[fixture('one',month+'-01',20)]});await settle();assert.match(ui.node('spent').textContent,/20/);assert.match(ui.node('data-status').textContent,/Falta la migración/);form(ui);await submit(ui);assert.equal(ui.mock.data.purchases.length,1);assert.match(ui.node('toast').textContent,/Falta aplicar la migración/);
});
