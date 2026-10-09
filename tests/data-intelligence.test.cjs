const test=require('node:test'),assert=require('node:assert/strict'),b=require('../budget.js');
const p=(id,date,total,store='Jumbo')=>({id,purchased_on:date,total,store});
const rows=[p('a','2026-01-01',30.01),p('b','2026-01-05',9.99,' JUMBO '),p('c','2026-01-20',60,'Lidl'),p('old','2025-12-31',1000),p('future','2026-02-01',500)];
const items=[{purchase_id:'a',name:'Café',line_total:15},{purchase_id:'a',name:' CAFÉ ',line_total:5},{purchase_id:'a',name:'Milk 1L',line_total:10.01},{purchase_id:'b',name:'café',line_total:9.99},{purchase_id:'a',name:'Cafe',line_total:0},{purchase_id:'old',name:'Café',line_total:1000}];
test('monthly summary uses cents, distinct purchases and uncapped budget usage',()=>{
 const m=b.dataIntelligence(rows,items,'2026-01',80);assert.deepEqual(m.summary,{spent:10000,count:3,average:3333,used:125});
 assert.deepEqual(b.dataIntelligence([p('x','2026-01-01',0.1),p('y','2026-01-02',0.2)],[],'2026-01',1).summary,{spent:30,count:2,average:15,used:30});
 const duplicated=b.dataIntelligence(rows.concat(rows[0]),items,'2026-01',80);assert.equal(duplicated.summary.spent,10000);assert.equal(duplicated.monthly.at(-1).total,10000);
});
test('empty period and zero budget never invent averages or invalid percentages',()=>{
 assert.deepEqual(b.dataIntelligence(rows,items,'2024-07',0).summary,{spent:0,count:0,average:null,used:null});
 assert.equal(b.dataIntelligence(rows,items,'2026-01',0).summary.used,null);
});
test('stores group outer spaces/case, include receipts without items, preserve distinct names',()=>{
 const m=b.dataIntelligence(rows,items,'2026-01',80);assert.deepEqual(m.stores.map(s=>[s.key,s.total,s.percentage]),[['lidl',6000,60],['jumbo',4000,40]]);assert.equal(m.stores[1].purchases.length,2);
 assert.equal(b.storeKey(' Jumbo '),'jumbo');assert.notEqual(b.storeKey('Jumbo Utrecht'),b.storeKey('Jumbo'));
});
test('products aggregate all matching lines but count each receipt once',()=>{
 const m=b.dataIntelligence(rows,items,'2026-01',80),coffee=m.products.find(p=>p.key==='café');assert.equal(coffee.total,2999);assert.equal(coffee.count,2);
 assert(m.products.some(p=>p.key==='cafe'));assert.equal(m.products.reduce((s,p)=>s+p.total,0),4000);assert.equal(m.summary.spent,10000);
 const found=m.products.filter(p=>b.normalize(p.name).includes(b.normalize('CAFE')));assert.equal(found.length,2);assert.notEqual(b.productKey('Milk 1L'),b.productKey('Milk 2L'));
});
test('monthly evolution is six consecutive months ending at selected month across years',()=>{
 const m=b.dataIntelligence(rows,items,'2026-01',80);assert.deepEqual(m.monthly.map(m=>m.month),['2025-08','2025-09','2025-10','2025-11','2025-12','2026-01']);assert.deepEqual(m.monthly.map(m=>m.total),[0,0,0,0,100000,10000]);
});
test('weekly evolution crosses year boundary but counts only selected-month spending',()=>{
 const weeks=b.weeklySpending(rows,'2026-01');assert.equal(weeks[0].from,'2025-12-29');assert.equal(weeks[0].to,'2026-01-04');assert.equal(weeks[0].total,3001);assert.equal(weeks.at(-1).to,'2026-02-01');assert.equal(weeks.at(-1).total,0);assert.equal(weeks.reduce((s,w)=>s+w.total,0),10000);
});
test('Monday/Sunday, leap February and daylight saving use calendar dates',()=>{
 const march=b.weeklySpending([p('sat','2026-03-28',1),p('sun','2026-03-29',2),p('mon','2026-03-30',4)],'2026-03');assert.equal(march.find(w=>w.from==='2026-03-23').total,300);assert.equal(march.at(-1).from,'2026-03-30');assert.equal(march.at(-1).total,400);
 const feb=b.weeklySpending([p('leap','2024-02-29',1)],'2024-02');assert.equal(feb.at(-1).total,100);assert.equal(feb.at(-1).to,'2024-03-03');
});
test('large models retain full totals while keeping identities separate',()=>{
 const ps=Array.from({length:1500},(_,i)=>p('p'+i,'2026-01-01',1,i%2?'JUMBO':' Jumbo '));const its=ps.map((p,i)=>({purchase_id:p.id,name:'Product '+i,line_total:1}));
 const m=b.dataIntelligence(ps,its,'2026-01',100);assert.equal(m.summary.spent,150000);assert.equal(m.stores.length,1);assert.equal(m.products.length,1500);assert.equal(m.summary.used,1500);
});

test('month/year options include empty intervening months and preserve manual selection',()=>{
 const options=b.dataMonths([p('old','2024-12-01',1)],'2026-01','2023-10');assert.equal(options[0],'2026-01');assert.equal(options.at(-1),'2023-10');assert(options.includes('2025-07'));assert.equal(new Set(options).size,options.length);
});
