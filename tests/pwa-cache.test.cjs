const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
function worker(options={}){
  const origin='https://example.test',scope=origin+'/casa-budget/';
  const handlers={},entries=new Map(),stores=new Map(),requests=[];
  let reply=()=>new Response('fresh',{status:200}),claimed=false,skipped=false;
  const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {async addAll(items){for(const request of items){requests.push(request);if(options.failAsset&&request.url.endsWith(options.failAsset))throw Error('HTTP404');store.set(request.url,new Response('installed'));}},async put(request,response){store.set(typeof request==='string'?request:request.url,response);},async match(request){return store.get(typeof request==='string'?request:request.url)?.clone();}};},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}};
  vm.runInNewContext(source,{URL,Request,Response,Promise,Set,caches,self:{location:{origin},registration:{scope},clients:{async claim(){claimed=true;}},skipWaiting(){skipped=true;},addEventListener(name,handler){handlers[name]=handler;}},async fetch(request){requests.push(request);return reply(request);}});
  return {stores,requests,caches,get claimed(){return claimed;},get skipped(){return skipped;},set reply(value){reply=value;},async install(){let promise;handlers.install({waitUntil(value){promise=value;}});await promise;},async activate(){let promise;handlers.activate({waitUntil(value){promise=value;}});await promise;},async request(path){let promise;handlers.fetch({request:new Request(path.startsWith('https:')?path:scope+path),respondWith(value){promise=value;}});return promise?await promise:undefined;}};
}
test('install reloads all twelve shell assets and activation preserves unrelated caches',async()=>{
  const sw=worker();await sw.caches.open('casa-shell-v1');await sw.caches.open('other-app');await sw.install();assert.equal(sw.requests.length,12);assert(sw.requests.every(request=>request.cache==='reload'));
  await sw.activate();assert(!sw.stores.has('casa-shell-v1'));assert(sw.stores.has('other-app'));assert(sw.claimed);
});
test('fresh config bypasses HTTP cache and replaces the offline copy',async()=>{
  const sw=worker();await sw.install();assert.equal(await (await sw.request('config.js')).text(),'fresh');assert.equal(sw.requests.at(-1).cache,'no-store');
  sw.reply=()=>{throw Error('offline');};assert.equal(await (await sw.request('config.js')).text(),'fresh');
});
test('HTTP failures never overwrite the last successful config',async()=>{
  const sw=worker();await sw.install();await sw.request('config.js');sw.reply=()=>new Response('failure',{status:500});assert.equal(await (await sw.request('config.js')).text(),'fresh');
});
test('service worker leaves external Supabase and non-shell requests untouched',async()=>{
  const sw=worker();assert.equal(await sw.request('https://project.supabase.co/auth/v1/user'),undefined);assert.equal(await sw.request('unrelated.json'),undefined);assert.equal(sw.requests.length,0);
});

test('old network scripts cannot replace installed shell; recovery query uses cached compatible core offline',async()=>{
 const sw=worker();await sw.install();const before=sw.requests.length;sw.reply=()=>new Response('old script');
 assert.equal(await (await sw.request('receipt.js')).text(),'installed');assert.equal(sw.requests.length,before);
 sw.reply=()=>{throw Error('offline');};assert.equal(await (await sw.request('supabase/functions/_shared/receipt-core.js?casa-module=v10&attempt=1')).text(),'installed');
});
test('failed core download leaves the old cache active, removes partial update and never skips waiting',async()=>{
 const sw=worker({failAsset:'receipt-core.js'});await sw.caches.open('casa-shell-v11-receipt-ux');await sw.caches.open('other-app');
 await assert.rejects(sw.install(),/HTTP404/);assert(!sw.skipped);assert(!sw.claimed);assert(sw.stores.has('casa-shell-v11-receipt-ux'));assert(sw.stores.has('other-app'));assert(!sw.stores.has('casa-shell-v12-paid-total'));
});
