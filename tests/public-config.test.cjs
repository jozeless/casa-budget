const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const defaults={supabaseUrl:'https://default.supabase.co',supabaseAnonKey:'sb_publishable_default'};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function mount(config=defaults,storage=new Map(),blocked=false){
  const nodes=new Map(),clients=[];let reloads=0;
  const element=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,hidden:true,classList:{toggle(_name,state){element(id).hidden=state;},add(){},remove(){}},reportValidity(){return true;},reset(){}});return nodes.get(id);};
  const localStorage={getItem(key){if(blocked)throw Error('Storage disabled');return storage.get(key)||null;},setItem(key,value){if(blocked)throw Error('Storage disabled');storage.set(key,value);},removeItem(key){if(blocked)throw Error('Storage disabled');storage.delete(key);}};
  const context={Date,Intl,URLSearchParams,Number,String,Map,Math,Promise,JSON,
    setTimeout(){},clearTimeout(){},location:{hash:'',search:'',reload(){reloads++;}},navigator:{},localStorage,
    window:{CASA_CONFIG:config,supabase:{createClient(url,key){clients.push({url,key});return {auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},async initialize(){return {error:null}},async getSession(){return {data:{session:null},error:null}},stopAutoRefresh(){}}}}}},
    document:{getElementById:element,querySelectorAll(){return [];}}};
  vm.runInNewContext(app,context);
  return {element,clients,storage,get reloads(){return reloads;},submit(){element('setup-form').onsubmit({preventDefault(){}})}};
}

test('new browser uses complete defaults without asking for setup',async()=>{
  const ui=mount();await settle();assert.deepEqual(ui.clients,[{url:'https://default.supabase.co',key:'sb_publishable_default'}]);assert.equal(ui.element('auth-view').hidden,false);
});
test('old local configuration cannot override deployed defaults',async()=>{
  const ui=mount(defaults,new Map([['casa_url','https://old.supabase.co'],['casa_key','sb_publishable_old']]));await settle();assert.equal(ui.clients[0].url,'https://default.supabase.co');
});
test('partial config never mixes default URL with a local key',async()=>{
  const ui=mount({supabaseUrl:defaults.supabaseUrl,supabaseAnonKey:''},new Map([['casa_key','sb_publishable_old']]));await settle();assert.equal(ui.clients.length,0);assert.equal(ui.element('setup-view').hidden,false);
});
test('rejects unsupported key formats, non-HTTPS URLs and incomplete pairs',async()=>{
  for(const config of [{...defaults,supabaseAnonKey:'sb_secret_forbidden'},{...defaults,supabaseAnonKey:'eyJlegacy'},{...defaults,supabaseAnonKey:''},{...defaults,supabaseUrl:'http://default.supabase.co'},{...defaults,supabaseUrl:'https://example.com'}]){
    const ui=mount(config);await settle();assert.equal(ui.clients.length,0);assert.equal(ui.element('setup-view').hidden,false);
  }
});
test('manual override is atomic, explicit and can be restored',async()=>{
  const ui=mount();await settle();ui.element('config-btn').onclick();
  ui.element('supabase-url').value=' https://alternate.supabase.co/ ';ui.element('supabase-key').value=' sb_publishable_alternate ';ui.submit();assert.equal(ui.reloads,1);
  const alternate=mount(defaults,ui.storage);await settle();assert.equal(alternate.clients[0].url,'https://alternate.supabase.co');assert.equal(alternate.clients[0].key,'sb_publishable_alternate');
  alternate.element('restore-config-btn').onclick();assert.equal(alternate.reloads,1);assert.equal(alternate.storage.has('casa_config_override'),false);
  const restored=mount(defaults,ui.storage);await settle();assert.equal(restored.clients[0].url,'https://default.supabase.co');
});
test('changing either deployed default invalidates a stale local override',async()=>{
  const storage=new Map([['casa_config_override',JSON.stringify({url:'https://alternate.supabase.co',key:'sb_publishable_alternate',defaultUrl:defaults.supabaseUrl,defaultKey:defaults.supabaseAnonKey})]]);
  for(const config of [{...defaults,supabaseUrl:'https://next.supabase.co'},{...defaults,supabaseAnonKey:'sb_publishable_rotated'}]){
    const ui=mount(config,storage);await settle();assert.equal(ui.clients[0].url,config.supabaseUrl);assert.equal(ui.clients[0].key,config.supabaseAnonKey);
  }
});
test('malformed override and blocked storage do not block valid defaults',async()=>{
  for(const ui of [mount(defaults,new Map([['casa_config_override','{']])),mount(defaults,new Map(),true)]){
    await settle();assert.equal(ui.clients[0].url,'https://default.supabase.co');
  }
});
test('invalid manual values are not stored and do not restart the page',async()=>{
  const ui=mount();await settle();ui.element('supabase-url').value='https://alternate.supabase.co';ui.element('supabase-key').value='sb_secret_forbidden';ui.submit();assert.equal(ui.reloads,0);assert.equal(ui.storage.size,0);assert.match(ui.element('config-message').textContent,/sb_publishable/);
});
test('blocked storage reports a persistent configuration error',async()=>{
  const ui=mount(defaults,new Map(),true);await settle();ui.element('supabase-url').value=defaults.supabaseUrl;ui.element('supabase-key').value=defaults.supabaseAnonKey;ui.submit();assert.match(ui.element('config-message').textContent,/almacenamiento/);assert.equal(ui.reloads,0);
});
