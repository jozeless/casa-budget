const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
function worker(){
  const origin='https://example.test',scope=origin+'/casa-budget/';
  const handlers={},entries=new Map(),stores=new Map(),requests=[];
  let reply=()=>new Response('fresh',{status:200}),claimed=false;
  const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {async addAll(items){for(const request of items){requests.push(request);store.set(request.url,new Response('installed'));}},async put(request,response){store.set(request.url,response);},async match(request){return store.get(request.url)?.clone();}};},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}};
  vm.runInNewContext(source,{URL,Request,Response,Promise,Set,caches,self:{location:{origin},registration:{scope},clients:{async claim(){claimed=true;}},skipWaiting(){},addEventListener(name,handler){handlers[name]=handler;}},async fetch(request){requests.push(request);return reply(request);}});
  return {stores,requests,caches,get claimed(){return claimed;},set reply(value){reply=value;},async install(){let promise;handlers.install({waitUntil(value){promise=value;}});await promise;},async activate(){let promise;handlers.activate({waitUntil(value){promise=value;}});await promise;},async request(path){let promise;handlers.fetch({request:new Request(path.startsWith('https:')?path:scope+path),respondWith(value){promise=value;}});return promise?await promise:undefined;}};
}
test('install reloads all seven shell assets and activation preserves unrelated caches',async()=>{
  const sw=worker();await sw.caches.open('casa-shell-v1');await sw.caches.open('other-app');await sw.install();assert.equal(sw.requests.length,7);assert(sw.requests.every(request=>request.cache==='reload'));
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
