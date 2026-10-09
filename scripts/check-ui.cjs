// Run with Playwright installed: node scripts/check-ui.cjs
// Serves the checkout locally; all Auth and database operations use in-memory fixtures.
process.env.TZ=process.env.TZ||'Europe/Amsterdam';
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
   const context=await browser.newContext({viewport:{width,height},timezoneId:Intl.DateTimeFormat().resolvedOptions().timeZone});let remote=0;const errors=[];
   await context.addInitScript(installMock,seed);
   await context.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:'/* Auth supplied by test fixture */'}));
   await context.route('https://*.supabase.co/**',route=>{remote++;return route.abort();});
   const page=await context.newPage();if(clock)await page.clock.install({time:clock});page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
   await page.goto(address);assert.deepEqual(errors,[],'application starts without browser errors');
   if(seed.noHousehold)await page.locator('#home-setup-view').waitFor({state:'visible'});
   else if(seed.failRead)await page.waitForFunction(()=>document.getElementById('data-status').textContent.includes('No se pudieron'));
   else await page.waitForFunction(()=>document.getElementById('data-status').textContent==='Compras actualizadas');
   return {page,context,errors,get remote(){return remote;}};
 }
 for(const [width,height] of [[320,568],[390,844],[568,320],[1280,900]]){
   for(const [name,seed] of [['empty',{purchases:[],items:[]}],['normal',normal],['many-negative',many]]){
     const ui=await open(width,height,seed),{page}=ui;
     assert.equal(await page.locator('#screen-heading').textContent(),'Inicio');assert.equal(await page.locator('#recent-purchases').count(),0);assert.equal(await page.locator('#app-nav [data-page]').count(),4);assert.equal(await page.locator('.topbar').innerText(),'⌂\nCASA\n↻');assert(await page.locator('#data-status').evaluate(el=>el.classList.contains('sr-only')));assert(!await page.locator('#invite-code').isVisible());
     if(name==='empty'){assert.match(await page.locator('#spent').textContent(),/0/);}
     if(name==='normal'){assert.match(await page.locator('#spent').textContent(),/20/);assert.match(await page.locator('#remaining').textContent(),/80/);}
     if(name==='many-negative'){assert.match(await page.locator('#remaining').textContent(),/-350/);assert.match(await page.locator('#weekly-amount').textContent(),/0/);assert(await page.locator('#budget-warning').isVisible());}
     const fab=await page.locator('#add-menu-btn').evaluate(el=>{
       const rect=el.getBoundingClientRect(),nav=document.getElementById('app-nav').getBoundingClientRect(),style=getComputedStyle(el);
       return {top:rect.top,bottom:rect.bottom,center:rect.x+rect.width/2,navTop:nav.top,navBottom:nav.bottom,navCenter:nav.x+nav.width/2,width:rect.width,height:rect.height,bg:style.backgroundColor,color:style.color,label:el.getAttribute('aria-label'),popup:el.getAttribute('aria-haspopup')};
     });
     assert(Math.abs(fab.center-fab.navCenter)<1,'FAB centered in navigation');
     assert(Math.abs(fab.navTop-fab.top-12)<1,'FAB protrudes only 12px above navigation');
     assert(fab.bottom>fab.navTop&&fab.bottom<fab.navBottom,'FAB overlaps the navigation surface');
     assert.equal(fab.bg,'rgb(123, 92, 255)');assert.equal(fab.color,'rgb(255, 255, 255)');
     assert(fab.width>=44&&fab.height>=44);assert.equal(fab.label,'Añadir compra');assert.equal(fab.popup,'dialog');
     await page.locator('#add-menu-btn').focus();assert(await page.locator('#add-menu-btn').evaluate(el=>document.activeElement===el&&getComputedStyle(el).outlineStyle!=='none'));
     await page.keyboard.press('Enter');assert(await page.locator('#add-menu-dialog').isVisible());await page.locator('[data-close="add-menu-dialog"]').click();
     const before=await page.evaluate(()=>mock.calls.length);
     for(const tab of ['history','data','settings','home']){
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
       await page.locator('[data-page=data]').click();assert.match(await page.locator('#product-report').textContent(),/café/i);assert.equal(await page.locator('#monthly-report .report-line').count(),6);
       await page.locator('#data-month').selectOption(lastMonth);await page.locator('[data-data-tab=products]').click();assert.match(await page.locator('#product-report').textContent(),/No hay productos/);await page.locator('[data-data-tab=stores]').click();assert.match(await page.locator('#store-report').textContent(),/500/);
     }
     await page.locator('[data-page=settings]').click();await page.evaluate(()=>document.querySelector('.shell').scrollTo(0,document.querySelector('.shell').scrollHeight));
     const boxes=await page.evaluate(()=>({last:document.getElementById('logout-btn').getBoundingClientRect().bottom,fab:document.getElementById('add-menu-btn').getBoundingClientRect().top,nav:document.getElementById('app-nav').getBoundingClientRect().top}));
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
 await page.locator('#add-item-btn').click();await page.locator('.item-name').fill('Leche');await page.locator('.item-total').fill('10');await page.locator('#save-purchase').click();await page.locator('#purchase-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.getElementById('spent').textContent.includes('30'));assert.equal(await page.locator('#progress-bar').evaluate(el=>el.style.width),'70%');
 await page.locator('[data-page=history]').click();await page.locator('#history-search').fill('leche');await page.locator('#purchases-list [data-purchase]').click();assert.match(await page.locator('#detail-items').textContent(),/Leche/);await page.locator('#delete-purchase').click();await page.locator('#detail-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>mock.data.purchases.length===2);
 assert.deepEqual(await page.evaluate(()=>mock.data.purchases.map(p=>p.id).sort()),['current','previous']);assert.equal(await page.locator('#purchases-list [data-purchase]').count(),0);
 await page.locator('[data-page=home]').click();assert.match(await page.locator('#spent').textContent(),/20/);assert.equal(await page.locator('#progress-bar').evaluate(el=>el.style.width),'80%');
 await page.locator('[data-page=settings]').click();await page.locator('#new-budget-btn').click();await page.locator('#budget-input').fill('150');await page.locator('#budget-form button[type=submit]').click();await page.locator('#budget-dialog').waitFor({state:'hidden'});assert.match(await page.locator('#remaining').textContent(),/130/);assert(Math.abs(parseFloat(await page.locator('#progress-bar').evaluate(el=>el.style.width))-130/150*100)<0.001);
 // Installed shell includes the new helper and survives a network failure.
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>document.getElementById('data-status').textContent==='Compras actualizadas');
 assert(await page.evaluate(async()=>{const cache=await caches.open('casa-shell-v7-data26');return !!(await cache.match('./budget.js'));}));
 await ui.context.setOffline(true);assert.match(await page.evaluate(async()=>await (await fetch('./budget.js')).text()),/Pure calendar/);await ui.context.setOffline(false);
 await page.locator('[data-page=settings]').click();await page.locator('#logout-btn').click();await page.locator('#auth-view').waitFor({state:'visible'});assert(!await page.locator('#app-nav').isVisible());assert(!await page.locator('#add-menu-btn').isVisible());
 await page.locator('#auth-config-btn').click();assert(await page.locator('#setup-view').isVisible());await page.locator('#config-cancel-btn').click();await page.locator('#auth-view').waitFor({state:'visible'});
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
   await p.evaluate(()=>mock.seed.failReadAfterWrite=true);await p.locator('#save-purchase').click();await p.locator('#purchase-dialog').waitFor({state:'hidden'});
   await p.waitForFunction(()=>document.getElementById('data-status').textContent.includes('Compra guardada'));
   assert.match(await p.locator('#spent').textContent(),/30/);assert.match(await p.locator('#toast').textContent(),/no repitas/);
   await p.locator('[data-page=history]').click();await p.locator('#history-search').fill('Aldi');await p.locator('#purchases-list [data-purchase]').click();await p.locator('#delete-purchase').click();
   await p.waitForFunction(()=>document.getElementById('data-status').textContent.includes('Compra eliminada'));
   assert.equal(await p.locator('#purchases-list [data-purchase]').count(),0);assert.match(await p.locator('#spent').textContent(),/20/);
   await p.evaluate(()=>mock.seed.failRead=false);await p.locator('#refresh-data-btn').click();await p.waitForFunction(()=>document.getElementById('data-status').textContent==='Compras actualizadas');
   assert.equal(await p.evaluate(()=>mock.data.purchases.length),2);assert.equal(stale.remote,0);assert.deepEqual(stale.errors,[]);await stale.context.close();
 }
 // Phase 2 editing, duplicate warnings, uncertain responses and full product history.
 for(const width of [320,1280]){
  const editing=await open(width,width===320?568:844,normal),p=editing.page;
  await p.locator('[data-page=history]').click();await p.locator('#purchases-list [data-purchase="current"]').click();await p.locator('#edit-purchase').click();
  assert.equal(await p.locator('.item-name').inputValue(),'Café');assert(await p.evaluate(()=>{const box=document.getElementById('purchase-dialog');const rect=box.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight+1&&box.scrollWidth<=box.clientWidth;}));
  if(width===320)await p.screenshot({path:'/tmp/casa-phase2-edit-mobile.png'});await p.locator('#purchase-store').fill('Plus');await p.locator('.item-qty').fill('2');await p.locator('.item-total').fill('25');await p.locator('#purchase-total').fill('30');
  await p.locator('#add-item-btn').click();await p.locator('.item-name').last().fill('Leche');await p.locator('.item-total').last().fill('5');
  await p.locator('#save-purchase').click();await p.locator('#purchase-dialog').waitFor({state:'hidden'});await p.waitForFunction(()=>document.getElementById('spent').textContent.includes('30'));
  assert.equal(await p.evaluate(()=>mock.data.purchases.length),2);assert.equal(await p.evaluate(()=>mock.data.items.length),2);
  await p.locator('[data-page=history]').click();await p.locator('#purchases-list [data-purchase="current"]').click();await p.locator('#edit-purchase').click();await p.locator('.remove-item').last().click();await p.locator('#purchase-total').fill('25');await p.locator('#save-purchase').click();await p.locator('#purchase-dialog').waitFor({state:'hidden'});await p.waitForFunction(()=>document.getElementById('spent').textContent.includes('25'));assert.equal(await p.locator('#progress-bar').evaluate(el=>el.style.width),'75%');
  assert.equal(await p.evaluate(()=>mock.data.items.length),1);assert.equal(await p.evaluate(()=>mock.data.purchases.find(p=>p.id==='current').store),'Plus');
  // A second member edits the same purchase while this form is open.
  await p.locator('[data-page=history]').click();await p.locator('#purchases-list [data-purchase="current"]').click();await p.locator('#edit-purchase').click();await p.evaluate(()=>mock.data.purchases.find(p=>p.id==='current').revision++);await p.locator('#save-purchase').click();await p.waitForFunction(()=>document.getElementById('toast').textContent.includes('compra cambió'));assert(await p.locator('#purchase-dialog').isVisible());await p.locator('[data-close=purchase-dialog]').click();
  assert.equal(editing.remote,0);assert.deepEqual(editing.errors,[]);await editing.context.close();
  const duplicate=await open(width,width===320?568:844,normal),d=duplicate.page;
  await d.locator('#add-menu-btn').click();await d.locator('#new-purchase-btn').click();await d.locator('#purchase-store').fill('Jumbo');await d.locator('#purchase-date').fill(month+'-01');await d.locator('#purchase-total').fill('20');await d.locator('#save-purchase').click();await d.locator('#duplicate-dialog').waitFor({state:'visible'});await d.locator('#duplicate-cancel').click();assert.equal(await d.evaluate(()=>mock.data.purchases.length),2);
  await d.locator('#save-purchase').click();await d.locator('#duplicate-save').click();await d.locator('#purchase-dialog').waitFor({state:'hidden'});assert.equal(await d.evaluate(()=>mock.data.purchases.length),3);assert.equal(duplicate.remote,0);assert.deepEqual(duplicate.errors,[]);await duplicate.context.close();
  const uncertain=await open(width,width===320?568:844,{purchases:[],loseResponse:true}),u=uncertain.page;
  await u.locator('#add-menu-btn').click();await u.locator('#new-purchase-btn').click();await u.locator('#purchase-store').fill('Aldi');await u.locator('#purchase-total').fill('10');await u.locator('#save-purchase').click();await u.waitForFunction(()=>document.getElementById('toast').textContent.includes('Guardado pendiente'));assert.equal(await u.evaluate(()=>mock.data.purchases.length),1);await u.locator('#save-purchase').click();await u.locator('#purchase-dialog').waitFor({state:'hidden'});assert.equal(await u.evaluate(()=>mock.data.purchases.length),1);assert.equal(uncertain.remote,0);assert.deepEqual(uncertain.errors,[]);await uncertain.context.close();
  const rows=Array.from({length:250},(_,i)=>purchase('p'+i,i<100?month+'-01':lastMonth+'-01',1));
  const product=await open(width,width===320?568:844,{purchases:rows,items:rows.map((p,i)=>({id:'i'+i,purchase_id:p.id,name:i%2?' Café ':'CAFÉ',quantity:1,line_total:1}))}),h=product.page;
  await h.locator('[data-page=data]').click();await h.locator('[data-data-tab=products]').click();await h.locator('[data-product="café"]').click();await h.waitForFunction(()=>document.getElementById('product-status').textContent==='Historial actualizado');assert.match(await h.locator('#product-summary').textContent(),/100 compras/);if(width===320)await h.screenshot({path:'/tmp/casa-phase2-product-mobile.png'});
  await h.locator('#product-month').selectOption('');assert.match(await h.locator('#product-summary').textContent(),/250 compras/);assert.equal(await h.locator('[data-original]').count(),250);
  await h.locator('#product-month').selectOption(lastMonth);assert.match(await h.locator('#product-summary').textContent(),/150 compras/);await h.locator('[data-original]').first().click();await h.locator('#detail-dialog').waitFor({state:'visible'});assert.match(await h.locator('#detail-items').textContent(),/caf/i);
  assert.equal(product.remote,0);assert.deepEqual(product.errors,[]);assert(await h.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await product.context.close();
 }
 // Remaining-budget boundaries and Settings actions on both viewport sizes.
 for(const width of [320,1280]){
  for(const [amount,spent,percent,level,color] of [[100,0,100,'high','rgb(61, 220, 151)'],[100,40,60,'medium','rgb(255, 184, 77)'],[100,70,30,'low','rgb(255, 107, 122)'],[100,100,0,'low','rgb(255, 107, 122)'],[100,125,0,'low','rgb(255, 107, 122)'],[0,0,0,'low','rgb(255, 107, 122)'],[0,20,0,'low','rgb(255, 107, 122)']]){
   const check=await open(width,width===320?568:900,{budget:amount,purchases:spent?[purchase('bar',month+'-01',spent)]:[]});
   const p=check.page;assert.equal(await p.locator('#progress-bar').evaluate(el=>el.style.width),percent+'%');assert.equal(await p.locator('#budget-progress').getAttribute('data-level'),level);await p.waitForFunction(color=>getComputedStyle(document.getElementById('progress-bar')).backgroundColor===color,color);assert.equal(await p.locator('#budget-progress').getAttribute('aria-valuenow'),String(percent));assert.equal(await p.locator('#budget-zero').isVisible(),amount===0);
   await check.context.close();
  }
  const settings=await open(width,width===320?568:900,normal),p=settings.page;
  await p.locator('[data-page=settings]').click();assert(await p.locator('#home-display').isVisible());assert(await p.locator('#settings-budget').isVisible());assert(await p.locator('#user-email').isVisible());assert(await p.locator('#invite-code').isVisible());
  await settings.context.grantPermissions(['clipboard-read','clipboard-write']);await p.locator('#copy-invite').click();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),'test-invite');
  await p.locator('#config-btn').click();assert(await p.locator('#setup-view').isVisible());assert(!await p.locator('#add-menu-btn').isVisible());await p.locator('#config-cancel-btn').click();await p.locator('#settings-page').waitFor({state:'visible'});
  await p.evaluate(()=>mock.data.household.monthly_budget=200);await p.locator('#refresh-data-btn').click();await p.waitForFunction(()=>document.getElementById('settings-budget').textContent.includes('200'));assert.equal(await p.locator('#progress-bar').evaluate(el=>el.style.width),'90%');
  await p.evaluate(()=>mock.seed.failRead=true);await p.locator('#refresh-data-btn').click();await p.waitForFunction(()=>document.getElementById('data-status').textContent.includes('No se pudieron'));assert(!await p.locator('#data-status').evaluate(el=>el.classList.contains('sr-only')));
  await p.evaluate(()=>mock.seed.failRead=false);await p.locator('#refresh-data-btn').click();await p.waitForFunction(()=>document.getElementById('data-status').textContent==='Compras actualizadas');assert(await p.locator('#data-status').evaluate(el=>el.classList.contains('sr-only')));
  await p.locator('[data-page=home]').click();await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('#progress-bar').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await p.screenshot({path:'/tmp/casa25-'+(width===320?'mobile':'desktop')+'.png'});
  assert.equal(settings.remote,0);assert.deepEqual(settings.errors,[]);await settings.context.close();
 }
 // Data Intelligence: one period, real totals, calendar charts and no tab/filter reads.
 for(const [width,height] of [[320,568],[390,844],[568,320],[1280,900]]){
  const seed={budget:80,purchases:[purchase('a','2026-01-01',30.01,'Jumbo'),purchase('b','2026-01-05',9.99,' JUMBO '),purchase('c','2026-01-20',60,'Lidl'),purchase('old','2025-12-31',1000),purchase('future','2026-02-01',500)],items:[{id:'i1',purchase_id:'a',name:'Café',quantity:1,line_total:15},{id:'i2',purchase_id:'a',name:' CAFÉ ',quantity:1,line_total:5},{id:'i3',purchase_id:'a',name:'Milk 1L',quantity:1,line_total:10.01},{id:'i4',purchase_id:'b',name:'café',quantity:1,line_total:9.99},{id:'i5',purchase_id:'a',name:'Cafe',quantity:1,line_total:0}]};
  const data=await open(width,height,seed),p=data.page;await p.locator('[data-page=data]').click();await p.locator('#data-month').selectOption('2026-01');
  assert.match(await p.locator('#data-total').textContent(),/100,00/);assert.equal(await p.locator('#data-count').textContent(),'3');assert.match(await p.locator('#data-average').textContent(),/33,33/);assert.match(await p.locator('#data-used').textContent(),/125/);assert.match(await p.locator('#data-budget-note').textContent(),/no con un presupuesto histórico/);
  assert.equal(await p.locator('#monthly-report .report-line').count(),6);assert.match(await p.locator('#monthly-report').textContent(),/enero de 2026/);assert.match(await p.locator('#monthly-report').textContent(),/agosto de 2025/);
  const reads=await p.evaluate(()=>mock.calls.length);await p.locator('#data-evolution').selectOption('weekly');assert.equal(await p.locator('#monthly-report .report-line').count(),5);assert.match(await p.locator('#data-evolution-note').textContent(),/solo se cuentan compras del mes/);
  await p.locator('[data-data-tab=stores]').click();assert.equal(await p.locator('#store-report [data-store]').count(),2);assert.match(await p.locator('[data-store=lidl]').textContent(),/60 %/);assert.match(await p.locator('[data-store=jumbo]').textContent(),/40 %/);
  await p.locator('[data-store=jumbo]').click();assert.equal(await p.locator('#data-store-purchases [data-purchase]').count(),2);await p.locator('#data-store-purchases [data-purchase]').first().click();assert(await p.locator('#detail-dialog').isVisible());await p.locator('[data-close=detail-dialog]').click();
  await p.locator('[data-data-tab=products]').click();await p.locator('#data-product-search').fill('CAFE');assert.equal(await p.locator('#product-report [data-product]').count(),2);assert.match(await p.locator('[data-product="café"]').textContent(),/2 compras distintas/);assert.match(await p.locator('[data-product=cafe]').textContent(),/1 compra distinta/);
  assert.equal(await p.evaluate(()=>mock.calls.length),reads);assert.equal(await p.locator('#data-month').inputValue(),'2026-01');
  await p.locator('[data-data-tab=products]').focus();await p.keyboard.press('Home');assert.equal(await p.locator('[data-data-tab=summary]').getAttribute('aria-selected'),'true');await p.keyboard.press('ArrowRight');assert.equal(await p.locator('[data-data-tab=stores]').getAttribute('aria-selected'),'true');await p.keyboard.press('End');assert.equal(await p.locator('[data-data-tab=products]').getAttribute('aria-selected'),'true');
  await p.locator('[data-product="café"]').click();await p.waitForFunction(()=>document.getElementById('product-status').textContent==='Historial actualizado');assert.equal(await p.locator('#product-month').inputValue(),'2026-01');await p.locator('#product-month').selectOption('');assert.match(await p.locator('#product-summary').textContent(),/2 compras/);await p.locator('[data-close=product-dialog]').click();
  await p.evaluate(()=>mock.data.household.monthly_budget=200);await p.locator('#refresh-data-btn').click();await p.waitForFunction(()=>document.getElementById('data-used').textContent.includes('50'));assert.equal(await p.locator('[data-data-tab=products]').getAttribute('aria-selected'),'true');assert.equal(await p.locator('#data-product-search').inputValue(),'CAFE');assert.equal(await p.locator('#data-month').inputValue(),'2026-01');
  await p.evaluate(()=>mock.seed.failRead=true);await p.locator('#refresh-data-btn').click();await p.waitForFunction(()=>document.getElementById('data-status').textContent.includes('desactualizada'));assert.match(await p.locator('#data-total').textContent(),/100,00/);
  await p.evaluate(()=>mock.seed.failRead=false);await p.locator('#refresh-data-btn').click();await p.waitForFunction(()=>document.getElementById('data-status').textContent==='Compras actualizadas');
  // CRUD through existing handlers must update Data and retain its period/tab/search.
  await p.locator('#add-menu-btn').click();await p.locator('#new-purchase-btn').click();await p.locator('#purchase-store').fill('New Shop');await p.locator('#purchase-date').fill('2026-01-03');await p.locator('#purchase-total').fill('10');await p.locator('#save-purchase').click();await p.locator('#purchase-dialog').waitFor({state:'hidden'});await p.waitForFunction(()=>document.getElementById('data-total').textContent.includes('110,00'));assert.equal(await p.locator('[data-data-tab=products]').getAttribute('aria-selected'),'true');assert.equal(await p.locator('#data-month').inputValue(),'2026-01');assert.equal(await p.locator('#data-product-search').inputValue(),'CAFE');
  await p.locator('[data-data-tab=stores]').click();await p.locator('[data-store="new shop"]').click();await p.locator('#data-store-purchases [data-purchase]').click();await p.locator('#edit-purchase').click();await p.locator('#purchase-total').fill('20');await p.locator('#save-purchase').click();await p.locator('#purchase-dialog').waitFor({state:'hidden'});await p.waitForFunction(()=>document.getElementById('data-total').textContent.includes('120,00'));assert.equal(await p.locator('[data-data-tab=stores]').getAttribute('aria-selected'),'true');
  await p.locator('#data-store-purchases [data-purchase]').click();await p.locator('#delete-purchase').click();await p.locator('#detail-dialog').waitFor({state:'hidden'});await p.waitForFunction(()=>document.getElementById('data-total').textContent.includes('100,00'));assert.equal(await p.locator('#data-count').textContent(),'3');assert.equal(await p.locator('#data-month').inputValue(),'2026-01');
  for(const tab of ['summary','stores','products']){await p.locator('[data-data-tab='+tab+']').click();assert.equal(await p.locator('#data-page [role=tab][aria-selected=true]').count(),1);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.shell').scrollWidth<=document.querySelector('.shell').clientWidth));}
  if(width===320||width===1280){for(const tab of ['summary','stores','products']){await p.locator('[data-data-tab='+tab+']').click();await p.evaluate(()=>document.querySelector('.shell').scrollTo(0,0));await p.screenshot({path:'/tmp/casa26-'+tab+'-'+(width===320?'mobile':'desktop')+'.png'});}}
  await p.locator('[data-page=settings]').click();await p.locator('#logout-btn').click();await p.locator('#auth-view').waitFor({state:'visible'});assert.equal(await p.locator('#data-total').textContent(),'—');assert.equal(await p.locator('#data-store-purchases [data-purchase]').count(),0);assert.equal(data.remote,0);assert.deepEqual(data.errors,[]);await data.context.close();
 }
 const emptyData=await open(320,568,{budget:0,purchases:[],items:[]});await emptyData.page.locator('[data-page=data]').click();assert.equal(await emptyData.page.locator('#data-average').textContent(),'Sin compras');assert.equal(await emptyData.page.locator('#data-used').textContent(),'No aplicable');assert(await emptyData.page.locator('#data-empty').isVisible());await emptyData.context.close();
 console.log(cases+' responsive scenarios passed; filters, real-value reports, safe navigation, shared reads, simulated insert/delete/budget/login/logout, PWA cache, calendar rollover, shared budgets and post-write read failures passed. Phase 2 editing, add/remove items, conflicts, duplicates, retries and paginated product histories passed on mobile/desktop. CASA 2.5 Settings, compact header, four views and remaining-budget boundaries passed. Data 2.6 metrics, store/product identities, shared period, charts, keyboard tabs, stale reads and session reset passed. No live Supabase calls.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack||error.message);process.exit(1);});
