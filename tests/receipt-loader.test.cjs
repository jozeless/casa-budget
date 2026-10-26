const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'receipt.js'),'utf8');
test('Pages publishes underscore directories and core is loaded synchronously before its consumers',()=>{
 assert(fs.existsSync(path.join(root,'.nojekyll')),'Root .nojekyll is required to publish _shared');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),scripts=[...html.matchAll(/<script\b([^>]*?)src="([^"]+)"([^>]*)>/g)];
 const core=scripts.findIndex(s=>s[2]==='supabase/functions/_shared/receipt-core.js'),ui=scripts.findIndex(s=>s[2]==='receipt.js'),app=scripts.findIndex(s=>s[2]==='app.js');
 assert(core>=0&&core<ui&&ui<app);assert(!/\b(async|defer)\b/.test(scripts[core][1]+scripts[core][3]));assert(!/\basync\b/.test(scripts[ui][1]+scripts[ui][3]));
});
test('every install-cache asset exists and is publishable under the Pages subdirectory',()=>{
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),match=sw.match(/const SHELL = (\[[^;]+\])/);assert(match);
 const paths=vm.runInNewContext(match[1]);assert.equal(paths.length,12);assert(paths.includes('./supabase/functions/_shared/receipt-core.js'));
 for(const file of paths){const target=file==='./'?'index.html':file.slice(2);assert(fs.statSync(path.join(root,target)).isFile(),target);assert(new URL(file,'https://jozeless.github.io/casa-budget/').pathname.startsWith('/casa-budget/'));}
 assert(sw.includes("'casa-shell-v16-logo-refresh'"));
});
for(const core of [undefined,{}, {apiVersion:1,inspectFile(){throw Error('old core invoked');}}])test('missing/incomplete core gives a readable error and never enables inspection',async()=>{
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:'',classList:{remove(){}},close(){this.open=false;},showModal(){this.open=true;}});return nodes.get(id);};
 const context={window:{CASA_RECEIPTS:core},document:{getElementById:get},Intl};vm.createContext(context);vm.runInContext(source,context);
 const ui=context.window.CASA_RECEIPT_UI({getStore:()=>({adjustments:[{purchase_id:'smart'}]})});
 get('new-receipt-btn').onclick();assert(get('receipt-dialog').open);assert.match(get('receipt-status').textContent,/No se pudo cargar.*Actualiza CASA/);assert(!get('receipt-process').disabled);assert.match(get('receipt-process').textContent,/Volver a cargar/);assert(get('receipt-file').disabled);assert(get('receipt-confirm').disabled);
 assert.equal(await ui.edit({id:'manual'}),false);assert.equal(await ui.edit({id:'smart'}),true);ui.reset();assert.equal(get('receipt-dialog').open,false);
});
