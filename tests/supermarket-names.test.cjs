const test=require('node:test'),assert=require('node:assert/strict');
const {supermarketName}=require('../budget.js');
test('known supermarket chains have uniform names, with complete word matching',()=>{
 for(const name of ['Jumbo','JUMBO','Jumbo Supermarkt','Jumbo Breda','Jumbo Supermercado','  Jumbo   Breda  ','Supermarkt Jumbo Breda','Jumbo-Breda'])assert.equal(supermarketName(name),'Jumbo',name);
 for(const name of ['Albert Heijn','albert   heijn Breda','AH','ah Amsterdam','AH XL','Supermercado Albert Heijn','Albert Heijn (Breda)'])assert.equal(supermarketName(name),'Albert Heijn',name);
});
test('unknown names are kept verbatim, including near matches and names mentioning other shops',()=>{
 for(const name of ['Lidl','  Tienda   desconocida  ','Jumboree','AHOY','BLAH','Albert Heijnen','Café Jumbo','Bakker bij AH',''])assert.equal(supermarketName(name),name);
});
test('normalization is idempotent and only transforms the passed store field',()=>{
 const purchase={store:'AH Breda',items:[{name:'Jumbo product',quantity:2,line_total:31.57}],total:28.98,adjustments:[{amount_cents:-100}],receipt:{store:'AH Breda'}};
 const original=structuredClone(purchase),saved={...purchase,store:supermarketName(purchase.store)};
 assert.equal(saved.store,'Albert Heijn');assert.equal(supermarketName(saved.store),saved.store);assert.deepEqual(purchase,original);assert.deepEqual(saved.items,original.items);assert.deepEqual(saved.adjustments,original.adjustments);assert.deepEqual(saved.receipt,original.receipt);assert.equal(saved.total,original.total);
});
