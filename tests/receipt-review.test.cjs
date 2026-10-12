const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../supabase/functions/_shared/receipt-core.js'),reference=require('./fixtures/jumbo-review-v2.json'),legacy=require('./fixtures/jumbo-receipt.json');
const draft=value=>({...core.draftFromExtraction(structuredClone(value)),reviewed:true});
test('Jumbo 8183 - 3495 = 4688: trailing linked emballage stays visible but never adds 45 cents',()=>{
 const d=draft(reference);assert.equal(d.items.length,8);assert(d.items.every(i=>i.quantity===1&&i.proposed));assert.equal(d.adjustments[0].amount_cents,-3495);assert.equal(d.adjustments[1].amount_cents,45);assert.equal(d.adjustments[1].effect,'informational');assert.match(d.adjustments[1].description,/Ret Emballage/);assert(core.reconcile(d).valid);assert.equal(core.reconcile(d).calculated,4688);assert.equal(core.reconcile(d).difference,0);
 assert.equal(reference.adjustments[1].effect,'applies_to_total','normalization does not mutate caller data');
});
test('single units require evidence and multiple explicit units never multiply printed subtotal again',()=>{
 const value=structuredClone(reference);value.items[0]={...value.items[0],quantity:2,quantity_basis:'explicit',source:'2 x 5.00',unit_price:5,line_total:10};
 const d=draft(value);assert.equal(d.items[0].quantity,2);assert(!d.items[0].proposed);assert(core.reconcile(d).valid);assert.equal(core.reconcile(d).calculated,4688);
 for(const source of [null,'','2 x 5.00','0,350 kg 10.00 /kg']){const uncertain=structuredClone(reference);uncertain.items[0].source=source;const result=draft(uncertain);assert.equal(result.items[0].quantity,null);assert(!core.reconcile(result).valid);}
});
test('quantity uncertainty blocks saving even with a matching printed subtotal; absent subtotal gives partial total',()=>{
 const v=structuredClone(reference);v.items[0].quantity_basis='uncertain';v.items[0].quantity=1;const d=draft(v);assert.equal(d.items[0].quantity,null);assert(!core.reconcile(d).valid);assert.equal(core.reconcile(d).calculated,4688);
 d.items[0].line_total=null;const r=core.reconcile(d);assert(!r.valid);assert(!r.complete);assert.equal(r.difference,null);assert.equal(r.calculated,3688);
});
test('real deposits/returns are not universally discarded, whether before or after total',()=>{
 for(const [kind,amount,position]of [['deposit',45,'before_total'],['return',-45,'after_total']]){
  const v=structuredClone(reference);v.adjustments.push({kind,description:'Real printed transaction',amount_cents:amount,item_index:null,source:'Explicit paid amount',effect:'applies_to_total',position});v.total+=amount/100;assert(core.reconcile(draft(v)).valid);
 }
 const v=structuredClone(reference);v.adjustments[1].position='before_total';v.total+=0.45;assert.equal(draft(v).adjustments[1].effect,'applies_to_total');assert(core.reconcile(draft(v)).valid);
});
test('already included promotions are not counted twice; uncertainty cannot be acknowledged away',()=>{
 const v=structuredClone(reference);v.items=[{...v.items[0],line_total:46.88}];v.adjustments[0].effect='already_included';const d=draft(v);assert(core.reconcile(d).valid);d.adjustments[0].effect='applies_to_total';assert(!core.reconcile(d).valid);d.adjustments[0].effect='uncertain';assert(!core.reconcile(d).valid);
});
test('a cent mismatch remains blocked; normalization never manufactures a balancing adjustment',()=>{
 const v=structuredClone(reference);v.total=46.89;const d=draft(v);assert.equal(d.adjustments.length,2);assert.equal(core.reconcile(d).difference,1);assert(!core.reconcile(d).valid);
});
test('legacy cached results remain readable without inferring missing quantities or classifying unknown positions',()=>{
 const v=structuredClone(legacy);v.items[0].quantity=null;const d=draft(v);assert.equal(d.items[0].quantity,null);assert.equal(d.adjustments[0].effect,'applies_to_total');assert(!core.reconcile(d).valid);assert(core.reconcile(draft(legacy)).valid);
});
test('versioned extraction requires explicit quantity basis and accounting effect',()=>{
 const v=structuredClone(reference);delete v.items[0].quantity_basis;assert.throws(()=>core.validateExtraction(v),/INVALID_EXTRACTION/);const other=structuredClone(reference);other.adjustments[0].effect='guess';assert.throws(()=>core.validateExtraction(other));
});
