const test=require('node:test');
const assert=require('node:assert/strict');
const budget=require('../budget.js');
const p=(date,total,store='Jumbo',id=date)=>({id,purchased_on:date,total,store});

test('weekly recommendation includes today through Sunday and excludes other months',()=>{
  const result=budget.weekly(600,[p('2026-10-01',100),p('2026-09-30',500),p('2026-11-01',400)],new Date(2026,9,9));
  assert.equal(result.remaining,50000);assert.equal(result.daysRemaining,23);assert.equal(result.daysThisWeek,3);assert.equal(result.amount,6522);assert.equal(result.to.getDate(),11);
});
test('Monday-to-Sunday week is clipped at month end',()=>{
  const result=budget.weekly(80,[],new Date(2026,7,31));
  assert.equal(result.daysThisWeek,1);assert.equal(result.daysRemaining,1);assert.equal(result.amount,8000);assert.equal(result.to.getMonth(),7);
});
test('Sunday and a leap-year February have correct remaining day counts',()=>{
  assert.equal(budget.weekly(30,[],new Date(2026,10,1)).amount,100);
  const leap=budget.weekly(100,[],new Date(2024,1,29));assert.equal(leap.daysRemaining,1);assert.equal(leap.daysThisWeek,1);assert.equal(leap.amount,10000);
});
test('DST changes do not change calendar day counts',()=>{
  const result=budget.weekly(100,[],new Date(2026,9,24));assert.equal(result.daysRemaining,8);assert.equal(result.daysThisWeek,2);assert.equal(result.amount,2500);
});
test('negative balances and zero budgets recommend zero without hiding overspending',()=>{
  const result=budget.weekly(100,[p('2026-10-01',120.50)],new Date(2026,9,9));assert.equal(result.remaining,-2050);assert.equal(result.amount,0);
  assert.equal(budget.weekly(0,[],new Date(2026,9,9)).amount,0);
});
test('money is aggregated in cents',()=>{
  assert.equal(budget.total([p('2026-10-01',0.1),p('2026-10-02',0.2)]),30);
});
test('six-month evolution crosses year boundary and excludes future months',()=>{
  const rows=budget.evolution([p('2025-12-01',5),p('2026-01-01',7),p('2026-02-01',100)],new Date(2026,0,15));
  assert.deepEqual(rows.map(row=>row.month),['2025-08','2025-09','2025-10','2025-11','2025-12','2026-01']);assert.equal(rows.at(-1).total,700);assert.equal(rows[0].total,0);
});
test('history combines month, exact supermarket and accent-insensitive product search',()=>{
  const purchases=[p('2026-10-01',10,'Jumbo','a'),p('2026-09-01',12,'Lidl','b')],items=[{purchase_id:'a',name:'Café'},{purchase_id:'b',name:'Café'}];
  assert.deepEqual(budget.history(purchases,items,{month:'2026-10',supermarket:'Jumbo',query:'CAFE'}).map(p=>p.id),['a']);
  assert.equal(budget.history(purchases,[],{query:'lidl'}).length,1);assert.equal(budget.history(purchases,[],{query:'cafe'}).length,0);
});
test('empty and large purchase sets return complete, real totals',()=>{
  assert.equal(budget.total([]),0);assert.equal(budget.history([],[],{}).length,0);
  const purchases=Array.from({length:1500},(_,index)=>p('2026-10-01',1,'Jumbo',String(index)));assert.equal(budget.history(purchases,[],{}).length,1500);assert.equal(budget.total(purchases),150000);
});

test('product identity normalizes whitespace and case but preserves accents, brands and sizes',()=>{
 assert.equal(budget.productKey('  Milk  WHOLE  '),'milk whole');assert.notEqual(budget.productKey('Café'),budget.productKey('Cafe'));assert.notEqual(budget.productKey('Milk 1L'),budget.productKey('Milk 2L'));
});
test('product history counts distinct purchases and recorded line totals',()=>{
 const rows=[{purchase_id:'a',purchased_on:'2026-10-01',line_total:2},{purchase_id:'a',purchased_on:'2026-10-01',line_total:3},{purchase_id:'b',purchased_on:'2026-09-01',line_total:4}];
 assert.equal(budget.productHistory(rows).count,2);assert.equal(budget.productHistory(rows).total,900);assert.equal(budget.productHistory(rows,'2026-10').total,500);assert.equal(budget.productHistory(rows,'2026-10').count,1);
});
