// Run with Playwright installed: node scripts/check-ui.cjs
// Serves the checkout locally; all Auth and database operations use in-memory fixtures.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const installMock=require('../tests/helpers/supabase-mock.cjs');
const budget=require('../budget.js');
const root=path.join(__dirname,'..');
const today=new Date(),month=budget.monthKey(today),lastMonth=budget.monthKey(new Date(today.getFullYear(),today.getMonth()-1,1));
const purchase=(id,date,total,store='Jumbo')=>({id,household_id:'test-home',purchased_on:date,total,store,created_at:date+'T12:00:00Z'});
const normal={budget:100,purchases:[purchase('current',month+'-01',20),purchase('previous',lastMonth+'-01',500,'Lidl')],items:[{id:'product',purchase_id:'current',name:'Café',quantity:1,line_total:20}]};
const many={budget:100,purchases:Array.from({length:450},(_,index)=>purchase('p'+String(index).padStart(4,'0'),month+'-01',1)),items:[]};
(async()=>{
 const server=http.createServer((request,response)=>{
   const name=new URL(request.url,'http://localhost').pathname.slice(1)||'index.html';
   if(!['index.html','styles.css','budget.js','app.js','config.js','sw.js','manifest.webmanifest','icon.svg'].includes(name)){response.writeHead(404);response.end();return;}
   response.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'application/json');response.end(fs.readFileSync(path.join(root,name)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address='http://localhost:'+server.address().port+'/';
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 let cases=0;
 try{
 async function open(width,height,seed,clock){
   const context=await browser.newContext({viewport:{width,height}});let remote=0;const errors=[];
   await context.addInitScript(installMock,seed);
   await context.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:'/* Auth supplied by test fixture */'}));
   await context.route('https://*.supabase.co/**',route=>{remote++;return route.abort();});
   const page=await context.newPage();if(clock)await page.clock.install({time:clock});page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
   await page.goto(address);
   if(seed.noHousehold)await page.locator('#home-setup-view').waitFor({state:'visible'});
   else if(seed.failRead)await page.waitForFunction(()=>document.getElementById('data-status').textContent.includes('No se pudieron'));
   else await page.waitForFunction(()=>document.getElementById('data-status').textContent==='Compras actualizadas');
   return {page,context,errors,get remote(){return remote;}};
 }
 for(const [width,height] of [[320,568],[390,844],[568,320],[1280,900]]){
   for(const [name,seed] of [['empty',{purchases:[],items:[]}],['normal',normal],['many-negative',many]]){
     const ui=await open(width,height,seed),{page}=ui;
     assert.equal(await page.locator('#screen-heading').textContent(),'Inicio');
     if(name==='empty'){assert.match(await page.locator('#recent-purchases').textContent(),/No hay/);assert.match(await page.locator('#spent').textContent(),/0/);}
     if(name==='normal'){assert.match(await page.locator('#spent').textContent(),/20/);assert.match(await page.locator('#remaining').textContent(),/80/);assert.equal(await page.locator('#recent-purchases [data-purchase]').count(),1);}
     if(name==='many-negative'){assert.match(await page.locator('#remaining').textContent(),/-350/);assert.match(await page.locator('#weekly-amount').textContent(),/0/);assert(await page.locator('#budget-warning').isVisible());assert.equal(await page.locator('#recent-purchases [data-purchase]').count(),3);}
     const before=await page.evaluate(()=>mock.calls.length);
     for(const tab of ['history','data','home']){
       await page.locator('[data-page="'+tab+'"]').click();assert(await page.locator('#'+tab+'-page').isVisible());assert.equal(await page.locator('[aria-current="page"]').count(),1);
       await page.locator('#add-menu-btn').click();assert(await page.locator('#new-purchase-btn').isVisible());assert(await page.locator('#add-menu-dialog button[disabled]').isDisabled());await page.locator('[data-close="add-menu-dialog"]').click();
       assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.shell').scrollWidth<=document.querySelector('.shell').clientWidth));
     }
     assert.equal(await page.evaluate(()=>mock.calls.length),before);
     await page.locator('[data-page=history]').click();
     if(name==='many-negative'){
       assert.equal(await page.locator('#purchases-list [data-purchase]').count(),50);await page.locator('#history-more-btn').click();assert.equal(await page.locator('#purchases-list [data-purchase]').count(),100);
       assert.equal(await page.evaluate(()=>mock.calls.filter(call=>call.table==='purchases'&&call.operation==='read').length),3);
     }
     if(name==='normal'){
       await page.locator('#history-month').selectOption('');assert.equal(await page.locator('#purchases-list [data-purchase]').count(),2);
       await page.locator('#history-search').fill('cafe');assert.equal(await page.locator('#purchases-list [data-purchase]').count(),1);
       await page.locator('#history-store').selectOption('Lidl');assert.equal(await page.locator('#purchases-list [data-purchase]').count(),0);
       await page.locator('[data-page=data]').click();assert.match(await page.locator('#product-report').textContent(),/café/);assert.equal(await page.locator('#monthly-report .report-line').count(),6);
       await page.locator('#data-month').selectOption(lastMonth);assert.match(await page.locator('#product-report').textContent(),/No hay productos/);assert.match(await page.locator('#store-report').textContent(),/500/);
     }
     await page.locator('.settings summary').click();await page.evaluate(()=>document.querySelector('.shell').scrollTo(0,document.querySelector('.shell').scrollHeight));
     const boxes=await page.evaluate(()=>({last:document.getElementById('copy-invite').getBoundingClientRect().bottom,fab:document.getElementById('add-menu-btn').getBoundingClientRect().top,nav:document.getElementById('app-nav').getBoundingClientRect().top}));
     assert(boxes.last<=boxes.fab&&boxes.last<=boxes.nav,'bottom controls clear fixed navigation');
     assert(await page.evaluate(()=>document.querySelector('.shell').getBoundingClientRect().bottom<=document.getElementById('add-menu-btn').getBoundingClientRect().top),'scrolling content never overlaps the FAB');
     if(name==='normal'&&(width===390||width===1280)){
       await page.locator('[data-page=home]').click();await page.evaluate(()=>document.querySelector('.shell').scrollTo(0,0));await page.screenshot({path:'/tmp/casa2-'+(width===390?'mobile':'desktop')+'.png',fullPage:true});
     }
     assert.equal(ui.remote,0);assert.deepEqual(ui.errors,[]);await ui.context.close();cases++;
   }
 }
 // Mutations happen only inside the fixture. Original seed purchases must survive.
 const ui=await open(390,844,normal),page=ui.page;
 await page.locator('#add-menu-btn').click();await page.locator('#new-purchase-btn').click();await page.locator('#purchase-store').fill('Aldi');await page.locator('#purchase-total').fill('10');
 await page.locator('#add-item-btn').click();await page.locator('.item-name').fill('Leche');await page.locator('.item-total').fill('10');await page.locator('#save-purchase').click();await page.locator('#purchase-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.getElementById('spent').textContent.includes('30'));
 await page.locator('[data-page=history]').click();await page.locator('#history-search').fill('leche');await page.locator('#purchases-list [data-purchase]').click();assert.match(await page.locator('#detail-items').textContent(),/Leche/);await page.locator('#delete-purchase').click();await page.locator('#detail-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>mock.data.purchases.length===2);
 assert.deepEqual(await page.evaluate(()=>mock.data.purchases.map(p=>p.id).sort()),['current','previous']);assert.equal(await page.locator('#purchases-list [data-purchase]').count(),0);
 await page.locator('[data-page=home]').click();assert.match(await page.locator('#spent').textContent(),/20/);
 await page.locator('#new-budget-btn').click();await page.locator('#budget-input').fill('150');await page.locator('#budget-form button[type=submit]').click();await page.locator('#budget-dialog').waitFor({state:'hidden'});assert.match(await page.locator('#remaining').textContent(),/130/);
 // Installed shell includes the new helper and survives a network failure.
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>document.getElementById('data-status').textContent==='Compras actualizadas');
 assert(await page.evaluate(async()=>{const cache=await caches.open('casa-shell-v4-framework-sync');return !!(await cache.match('./budget.js'));}));
 await ui.context.setOffline(true);assert.match(await page.evaluate(async()=>await (await fetch('./budget.js')).text()),/Pure calendar/);await ui.context.setOffline(false);
 await page.locator('#logout-btn').click();await page.locator('#auth-view').waitFor({state:'visible'});assert(!await page.locator('#app-nav').isVisible());assert(!await page.locator('#add-menu-btn').isVisible());
 await page.locator('#auth-email').fill('test@example.com');await page.locator('#auth-password').fill('synthetic-password');
 await page.locator('#signup-btn').click();await page.waitForFunction(()=>mock.calls.some(call=>call.operation==='signUp'));
 await page.locator('#forgot-password-btn').click();await page.waitForFunction(()=>document.getElementById('auth-message').textContent.includes('Si existe'));
 await page.locator('#signin-btn').click();await page.waitForFunction(()=>document.getElementById('data-status').textContent==='Compras actualizadas');assert(await page.locator('#app-nav').isVisible());
 assert.equal(ui.remote,0);assert.deepEqual(ui.errors,[]);await ui.context.close();
 for(const action of ['create','join']){
   const setup=await open(action==='create'?390:1280,844,{noHousehold:true,purchases:[],items:[]});
   if(action==='create'){await setup.page.locator('#home-name').fill('Nuevo hogar');await setup.page.locator('#initial-budget').fill('200');await setup.page.locator('#create-home-form button').click();}
   else {await setup.page.locator('#join-code').fill('test-invite');await setup.page.locator('#join-home-form button').click();}
   await setup.page.waitForFunction(()=>document.getElementById('data-status').textContent==='Compras actualizadas');assert(await setup.page.locator('#app-nav').isVisible());assert.equal(setup.remote,0);assert.deepEqual(setup.errors,[]);await setup.context.close();
 }
 const failed=await open(320,568,{failRead:true,purchases:[],items:[]});assert.equal(await failed.page.locator('#spent').textContent(),'—');await failed.page.evaluate(()=>mock.seed.failRead=false);await failed.page.locator('#refresh-data-btn').click();await failed.page.waitForFunction(()=>document.getElementById('data-status').textContent==='Compras actualizadas');assert.equal(failed.remote,0);assert.deepEqual(failed.errors,[]);await failed.context.close();
 // Calendar rollover and post-write read failures in real browser DOM, fixtures only.
 for(const width of [320,1280]){
   const calendar=await open(width,844,{budget:100,purchases:[purchase('oct','2026-10-01',20),purchase('nov','2026-11-01',30)]},new Date(2026,9,31,23,59,59));
   await calendar.page.locator('[data-page=data]').click();
   await calendar.page.locator('#data-month').selectOption('2026-10');
   await calendar.page.clock.runFor(2000);
   assert.match(await calendar.page.locator('#period-heading').textContent(),/noviembre/);
   assert.match(await calendar.page.locator('#remaining').textContent(),/70/);
   assert.equal(await calendar.page.locator('#history-month').inputValue(),'2026-11');
   assert.equal(await calendar.page.locator('#data-month').inputValue(),'2026-10');
   await calendar.page.evaluate(()=>mock.data.household.monthly_budget=200);
   await calendar.page.locator('#refresh-data-btn').click();
   await calendar.page.waitForFunction(()=>document.getElementById('remaining').textContent.includes('170'));
   assert.equal(calendar.remote,0);assert.deepEqual(calendar.errors,[]);await calendar.context.close();
   const stale=await open(width,844,normal),p=stale.page;
   await p.locator('#add-menu-btn').click();await p.locator('#new-purchase-btn').click();await p.locator('#purchase-store').fill('Aldi');await p.locator('#purchase-total').fill('10');
   await p.evaluate(()=>mock.seed.failRead=true);await p.locator('#save-purchase').click();await p.locator('#purchase-dialog').waitFor({state:'hidden'});
   await p.waitForFunction(()=>document.getElementById('data-status').textContent.includes('Compra guardada'));
   assert.match(await p.locator('#spent').textContent(),/30/);assert.match(await p.locator('#toast').textContent(),/no repitas/);
   await p.locator('[data-page=history]').click();await p.locator('#history-search').fill('Aldi');await p.locator('#purchases-list [data-purchase]').click();await p.locator('#delete-purchase').click();
   await p.waitForFunction(()=>document.getElementById('data-status').textContent.includes('Compra eliminada'));
   assert.equal(await p.locator('#purchases-list [data-purchase]').count(),0);assert.match(await p.locator('#spent').textContent(),/20/);
   await p.evaluate(()=>mock.seed.failRead=false);await p.locator('#refresh-data-btn').click();await p.waitForFunction(()=>document.getElementById('data-status').textContent==='Compras actualizadas');
   assert.equal(await p.evaluate(()=>mock.data.purchases.length),2);assert.equal(stale.remote,0);assert.deepEqual(stale.errors,[]);await stale.context.close();
 }
 console.log(cases+' responsive scenarios passed; filters, real-value reports, safe navigation, shared reads, simulated insert/delete/budget/login/logout, PWA cache, calendar rollover, shared budgets and post-write read failures passed. No live Supabase calls.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.message);process.exit(1);});
