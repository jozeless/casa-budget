const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const installMock=require('./helpers/supabase-mock.cjs');const budget=require('../budget.js');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
function mount(seed,initialDate){
 let clock=initialDate?new Date(initialDate).getTime():Date.now();
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 let modelCalls=0;
 const events={},timers=[],storage=new Map(),rows=[];
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:true,dataset:{},style:{setProperty(name,value){this[name]=value;}},classList:{toggle(_name,value){node(id).hidden=value;},add(){},remove(){}},attributes:{},setAttribute(name,value){this.attributes[name]=value;},reset(){},close(){this.open=false;},showModal(){this.open=true;}});return nodes.get(id);};
 const buttons=['home','history','data','settings'].map(name=>({dataset:{page:name},setAttribute(){},removeAttribute(){}}));
 const dataButtons=['summary','stores','products'].map(name=>({dataset:{dataTab:name},attributes:{},setAttribute(key,value){this.attributes[key]=value;},focus(){}}));
 const context={Date:ClockDate,confirm(){return true;},Intl,URLSearchParams,Number,String,Map,Set,Math,Promise,JSON,setTimeout,clearTimeout,queueMicrotask,navigator:{},history:{replaceState(){}},location:{hash:'',search:''},document:{addEventListener(name,fn){events[name]=fn;},getElementById:node,querySelectorAll(selector){return selector==='[data-page]'?buttons:selector==='[data-data-tab]'?dataButtons:selector==='#items-container .item-row'?rows:[];}},localStorage:{getItem(key){return storage.get(key)||null;},setItem(key,value){storage.set(key,value);},removeItem(key){storage.delete(key);}},window:{crypto:require('node:crypto').webcrypto,setTimeout(fn,delay){timers.push({fn,delay});return timers.length;},clearTimeout(){},addEventListener(name,fn){events[name]=fn;},CASA_BUDGET:{...budget,dataIntelligence(...args){modelCalls++;return budget.dataIntelligence(...args);}},CASA_CONFIG:{supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'sb_publishable_test'}}};
 vm.createContext(context);vm.runInContext('('+installMock.toString()+')('+JSON.stringify(seed)+')',context);vm.runInContext(app,context);
 return {node,buttons,dataButtons,get modelCalls(){return modelCalls;},mock:context.window.mock,events,timers,rows,reload(){vm.runInContext(app,context);},setDate(date){clock=new Date(date).getTime();}};
}
const periods=[{id:'first',household_id:'test-home',starts_on:'2026-10-19',ends_on:null,purchases_budget:600,fun_budget:240}];
const fixture=(id,date,total)=>({id,household_id:'test-home',store:'Jumbo',purchased_on:date,total,created_at:date+'T12:00:00Z'});
test('first period excludes October 18 and includes subsequent November until manual recharge',async()=>{
 const ui=mount({periods,purchases:[fixture('old','2026-10-18',100),fixture('real','2026-10-19',28.98)]},'2026-10-25T12:00:00');await settle();assert.match(ui.node('remaining').textContent,/571,02/);const n=ui.mock.calls.length;ui.setDate('2026-11-01T12:00:00');ui.events.focus();await settle();assert.match(ui.node('remaining').textContent,/571,02/);assert.equal(ui.mock.calls.length,n);assert.match(ui.node('period-heading').textContent,/19 de octubre/);
});
test('refresh replaces all period/FUN state while navigation does not query',async()=>{
 const ui=mount({periods,purchases:[fixture('old','2026-10-18',100)]},'2026-10-25T12:00:00');await settle();const n=ui.mock.calls.length;ui.buttons.find(b=>b.dataset.page==='data').onclick();assert.equal(ui.mock.calls.length,n);ui.mock.data.budget_periods=[{...periods[0],ends_on:'2026-10-24'},{...periods[0],id:'new',starts_on:'2026-10-24'}];await ui.node('refresh-data-btn').onclick();assert.match(ui.node('period-heading').textContent,/24 de octubre/);assert.match(ui.node('remaining').textContent,/600,00/);
});
test('failed/missing period reads block writes and do not present a fresh balance',async()=>{
 const ui=mount({periods,noPeriodsMigration:true},'2026-10-25T12:00:00');await settle();assert.match(ui.node('data-status').textContent,/CASA 3.3/);assert(ui.node('add-menu-btn').disabled);assert.equal(ui.mock.calls.filter(c=>c.operation==='casa_save_purchase').length,0);
});
test('empty initialized periods require explicit admin initialization; no month fallback',async()=>{
 const ui=mount({periods:[]},'2026-10-25T12:00:00');await settle();assert.match(ui.node('data-status').textContent,/inicializar/);assert(ui.node('start-period-btn').disabled);
});
test('pagination still loads more than one Supabase page for purchases',async()=>{
 const ui=mount({periods,purchases:Array.from({length:450},(_,i)=>fixture('p'+i,'2026-10-20',1))},'2026-10-25T12:00:00');await settle();assert.match(ui.node('remaining').textContent,/150,00/);assert.equal(ui.mock.calls.filter(c=>c.table==='purchases'&&c.operation==='read').length,3);assert.equal((ui.node('purchases-list').innerHTML.match(/data-purchase=/g)||[]).length,50);
});
test('historical selection keeps its frozen budget after refresh and logout resets it',async()=>{
 const ui=mount({periods:[{...periods[0],ends_on:'2026-10-24',purchases_budget:500},{...periods[0],id:'new',starts_on:'2026-10-24'}],purchases:[fixture('old','2026-10-20',100)]},'2026-10-25T12:00:00');await settle();ui.node('data-month').value='first';ui.node('data-month').onchange();assert.match(ui.node('data-used').textContent,/20/);await ui.node('refresh-data-btn').onclick();assert.equal(ui.node('data-month').value,'first');assert.match(ui.node('data-budget-note').textContent,/congelado/);await ui.node('logout-btn').onclick();assert.equal(ui.node('remaining').textContent,'—');
});
