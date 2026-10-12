const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const core=require('../supabase/functions/_shared/receipt-core.js'),jumbo=require('./fixtures/jumbo-receipt.json');
const id='30000000-0000-0000-0000-000000000001',home='10000000-0000-0000-0000-000000000001';
async function mock(options={}){
 const {createHandler}=await import('../supabase/functions/_shared/extractor.mjs');let paid=0,patches=[],reserved=0;const row={id,household_id:home,path:home+'/'+id+'/original',status:'upload_pending',mime:'image/png',bytes:fs.statSync('icon-192.png').size};let cached=options.cached;
 const fetcher=async(url,init={})=>{
  const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
  if(url.endsWith('/auth/v1/user'))return options.noAuth?response({},401):response({id:'user'});
  if(url.includes('/household_members?'))return response(options.foreign?[]:[{user_id:'user'}]);
  if(url.includes('/purchase_receipts?')&&(!init.method||init.method==='GET'))return response(options.foreign?[]:[row]);
  if(url.includes('casa_receipt_claim')){reserved++;if(options.busy||reserved>1&&!cached)return response({code:'55000'},400);if(options.quota)return response({code:'54000'},400);return response({cached:!!cached,receipt:{...row,result:cached?jumbo:null}});}
  if(url.includes('/storage/v1/'))return options.uploadFail?response({},404):new Response(fs.readFileSync('icon-192.png'));
  if(url==='https://api.openai.com/v1/responses'){paid++;if(options.timeout)throw Object.assign(Error('time'),{name:'TimeoutError'});if(options.apiFail)return response({},429);if(options.transportLost)throw Error('Lost connection');const payload=JSON.parse(init.body);assert.equal(payload.store,false);assert.equal(payload.text.format.strict,true);assert(!JSON.stringify(payload).includes('service-secret'));return response({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(options.badJson?{store:'Jumbo'}:jumbo)}]}],usage:{input_tokens:3000,output_tokens:1000}});}
  if(init.method==='PATCH'){patches.push(JSON.parse(init.body));if(options.persistFail)return response({},500);if(patches.at(-1).status==='review')cached=true;return response([row]);}
  throw Error('Unexpected request '+url);
 };
 const handler=createHandler({core,validatePdf:async()=>{},fetcher,env:name=>({SUPABASE_URL:'https://fake.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-secret',SUPABASE_ANON_KEY:'public',OPENAI_API_KEY:'openai-secret'})[name]});
 const call=async()=>{const response=await handler(new Request('https://edge.test',{method:'POST',headers:{authorization:'Bearer synthetic',origin:'https://jozeless.github.io'},body:JSON.stringify({receiptId:id})}));return {status:response.status,body:await response.json()};};
 return {call,get paid(){return paid;},patches};
}
test('authenticated extraction caches result before response and retry incurs one paid call',async()=>{const m=await mock();assert.equal((await m.call()).status,200);assert.equal((await m.call()).body.cached,true);assert.equal(m.paid,1);assert.equal(m.patches[0].status,'review');assert(!JSON.stringify((await m.call()).body).includes('secret'));});
for(const [name,options,expected]of [['foreign household',{foreign:true},403],['invalid JWT',{noAuth:true},401],['daily quota',{quota:true},429],['concurrent request',{busy:true},409]])test(name+' never calls OpenAI',async()=>{const m=await mock(options);assert.equal((await m.call()).status,expected);assert.equal(m.paid,0);});
test('missing upload does not call OpenAI and persists recoverable error',async()=>{const m=await mock({uploadFail:true});assert.equal((await m.call()).body.error,'UPLOAD_MISSING');assert.equal(m.paid,0);assert.equal(m.patches[0].status,'error');});
test('OpenAI limit returns safe error without provider text',async()=>{const m=await mock({apiFail:true});assert.equal((await m.call()).body.error,'OPENAI_LIMIT');assert.equal(m.patches[0].status,'error');});
for(const [name,options]of [['invalid extraction',{badJson:true}],['timeout',{timeout:true}],['persistence failure',{persistFail:true}],['lost provider response',{transportLost:true}]])test(name+' stays reserved instead of risking another paid request',async()=>{const m=await mock(options);assert.notEqual((await m.call()).status,200);assert.equal(m.paid,1);assert.equal((await m.call()).body.error,'PROCESSING');assert.equal(m.paid,1);});
