(() => {
'use strict';
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('es-NL', {style:'currency',currency:'EUR'}).format(Number(n)||0);
const dateLocal = () => {const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const safe = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const store = {client:null,user:null,household:null,purchases:[],items:[],selected:null,loaded:false,dataVersion:0,page:'home',historyLimit:50};
const analytics=window.CASA_BUDGET;
let loadTask=null;
let routeTask=null;
let renderedDate=null;
let calendarTimer;
function checkCalendar(){
  if(store.loaded&&store.household&&!recovery.active&&renderedDate!==dateLocal()){
    updateFilters();render();
  }
}
function scheduleCalendar(){
  if(!window.setTimeout)return;
  window.clearTimeout(calendarTimer);
  const now=new Date(),midnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
  calendarTimer=window.setTimeout(()=>{checkCalendar();scheduleCalendar();},midnight-now+50);
}
function resumeCalendar(){checkCalendar();scheduleCalendar();}
function resetDashboard(){
  for(const id of ['remaining','spent','budget','weekly-amount'])$(id).textContent='—';
  for(const id of ['recent-purchases','purchases-list','store-report','product-report','monthly-report'])$(id).innerHTML='';
  $('purchase-count').textContent='';$('weekly-period').textContent='';$('progress-bar').style.width='0%';
  $('budget-warning').classList.add('hidden');
  for(const id of ['history-month','history-store','history-search','data-month']){
    $(id).value='';if($(id).dataset){delete $(id).dataset.initialized;delete $(id).dataset.manual;delete $(id).dataset.currentMonth;}
  }
  store.page='home';store.historyLimit=50;
  for(const id of ['purchase-dialog','detail-dialog','budget-dialog','add-menu-dialog'])if($(id).open)$(id).close();
}
const view = name => {
  ['setup','auth','recovery','home-setup','dashboard'].forEach(v=>$(v+'-view').classList.toggle('hidden',v!==name));
  const showNav=name==='dashboard'&&!!store.household&&!recovery.active;
  $('app-nav').classList.toggle('hidden',!showNav);$('add-menu-btn').classList.toggle('hidden',!showNav);
  document.body?.classList.toggle('app-open',showNav);
};
let toastTimer;
const notice = msg => {const el=$('toast'); el.textContent=msg;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),4500);};
const fail = err => {notice('Error: '+(err?.message||'Intenta nuevamente'));};
const configOverrideKey = 'casa_config_override';
function publicConfig(url, key){
  url=typeof url==='string'?url.trim():'';
  key=typeof key==='string'?key.trim():'';
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))return null;
  return {url:url.replace(/\/$/,''),key};
}
function defaultConfig(){
  const config=window.CASA_CONFIG||{};
  return publicConfig(config.supabaseUrl,config.supabaseAnonKey);
}
function clientConfig(){
  const defaults=defaultConfig();
  try{
    const override=JSON.parse(localStorage.getItem(configOverrideKey)||'null');
    // An override belongs to this default pair; updated defaults supersede stale overrides.
    if(override && override.defaultUrl===(defaults?.url||'') && override.defaultKey===(defaults?.key||'')){
      const pair=publicConfig(override.url,override.key);
      if(pair)return pair;
    }
    if(defaults)return defaults;
    // Preserve complete public settings from earlier manual setup, without mixing sources.
    return publicConfig(localStorage.getItem('casa_url'),localStorage.getItem('casa_key'));
  }catch{return defaults;}
}
function openConfig(){
  const config=clientConfig();
  $('supabase-url').value=config?.url||'';
  $('supabase-key').value=config?.key||'';
  $('restore-config-btn').disabled=!defaultConfig();
  $('config-cancel-btn').disabled=!config;
  $('config-message').textContent=defaultConfig()?'Los cambios se aplican solo a este navegador. Puedes restaurar la configuración predeterminada.':'Falta una configuración pública válida. Introduce ambos datos del mismo proyecto.';
  view('setup');
}
function restartWithConfig(){
  // Restart the page so no old client, pending request, or household state is reused.
  authSubscription?.unsubscribe();
  store.client?.auth.stopAutoRefresh();
  location.reload();
}
const authRedirect = 'https://jozeless.github.io/casa-budget/';
// Read only link metadata; the SDK handles credentials and session creation.
const linkParams = new URLSearchParams(location.hash.slice(1));
const linkQuery = new URLSearchParams(location.search);
const linkError = linkParams.has('error') || linkParams.has('error_code') || linkQuery.has('error') || linkQuery.has('error_code');
const recoveryLink = linkParams.get('type')==='recovery' || linkQuery.get('type')==='recovery';
const recovery = {active:recoveryLink || linkError, status:'pending', userId:null, busy:false, cancelled:false};
let authSubscription;
let authGeneration=0;
const recoveryMessage = message => { $('recovery-message').textContent=message; };
function showRecovery(){
  view('recovery');
  $('save-password').disabled=recovery.status!=='valid' || recovery.busy;
}
function invalidRecovery(){
  recovery.active=true; recovery.status='invalid'; recovery.userId=null;
  $('recovery-form').reset();
  recoveryMessage('El enlace ha caducado o no es válido. Solicita un nuevo correo de recuperación.');
  showRecovery();
}
function validRecovery(session){
  if(recovery.status==='invalid' || recovery.cancelled)return;
  if(!session?.user?.id || !session.access_token){invalidRecovery();return;}
  recovery.active=true; recovery.status='valid'; recovery.userId=session.user.id;
  if(!recovery.busy)recoveryMessage('Introduce y confirma tu nueva contraseña.');
  showRecovery();
}
function confirmedAuthError(error){
  return error?.status===401 || error?.status===403 || error?.name==='AuthImplicitGrantRedirectError' ||
    ['session_not_found','session_expired','refresh_token_not_found','refresh_token_already_used','otp_expired','bad_jwt','invalid_token'].includes(error?.code);
}
function passwordError(error, changingPassword=false){
  if(error?.status===429 || error?.code==='over_email_send_rate_limit' || error?.code==='over_request_rate_limit') return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  if(error?.code==='weak_password' || error?.code==='same_password' || (changingPassword&&error?.status===422)) return 'La contraseña ha sido rechazada. Utiliza una contraseña diferente que cumpla la política de seguridad.';
  return 'No se pudo completar la operación. Comprueba tu conexión y vuelve a intentarlo.';
}
async function start(){
  const config=clientConfig();
  if(!config){openConfig();return;}
  const {url,key}=config;
  const generation=++authGeneration;
  try {
    authSubscription?.unsubscribe();
    if(recovery.active){
      if(linkError)invalidRecovery();
      else {
        recovery.status='pending';recovery.userId=null;
        recoveryMessage('Verificando enlace…');showRecovery();
      }
    }
    store.client=window.supabase.createClient(url,key);$('connection-state').textContent='Conectado';
    authSubscription=store.client.auth.onAuthStateChange((event,session)=>{
      if(generation!==authGeneration)return;
      const newId=session?.user?.id||null;
      const changed=newId!==(store.user?.id||null);
      store.user=session?.user||null;
      if(changed){store.household=null;store.loaded=false;store.dataVersion++;store.purchases=[];store.items=[];resetDashboard();}
      if(event==='PASSWORD_RECOVERY'){
        validRecovery(session);return;
      }
      if(recovery.active){
        // INITIAL_SESSION and SIGNED_IN alone do not prove recovery.
        if(event==='SIGNED_OUT' || (recovery.status==='valid' && newId && newId!==recovery.userId))invalidRecovery();
        return;
      }
      if(changed&&event!=='INITIAL_SESSION')setTimeout(()=>route().catch(fail),0);
    }).data.subscription;
    // Initialization can finish before its deferred PASSWORD_RECOVERY notification.
    const {error:initError}=await store.client.auth.initialize();
    if(generation!==authGeneration)return;
    if(initError)throw initError;
    const {data:{session},error}=await store.client.auth.getSession();
    if(generation!==authGeneration)return;
    if(error)throw error;
    store.user=session?.user||null;
    if(recovery.active){
      if(recovery.status==='invalid'){showRecovery();return;}
      if(!session){invalidRecovery();return;}
      // Only accept a session from this URL, never an unrelated stored session.
      if(recoveryLink && linkParams.get('access_token') && linkParams.get('refresh_token') &&
        session.access_token===linkParams.get('access_token'))validRecovery(session);
      if(recovery.status==='valid' && session.user?.id!==recovery.userId)invalidRecovery();
      else if(recovery.status==='pending' && recoveryLink && !linkParams.get('access_token') && !linkQuery.get('code'))invalidRecovery();
      showRecovery();return;
    }
    await route();
  }catch(e){
    if(generation!==authGeneration)return;
    if(recovery.active){
      if(confirmedAuthError(e))invalidRecovery();
      else {recovery.status='pending';recovery.userId=null;recoveryMessage(passwordError(e));showRecovery();}
    }
    else {fail(e);view('setup');}
  }
}
async function route(){
  if(recovery.active){showRecovery();return;}
  if(!store.user){view('auth');return;}
  const userId=store.user.id;
  if(routeTask?.userId===userId)return routeTask.promise;
  const promise=(async()=>{
    if(!store.household){
      const {data,error}=await store.client.from('household_members').select('household_id').eq('user_id',userId).maybeSingle();if(error)throw error;
      if(recovery.active){showRecovery();return;}
      if(store.user?.id!==userId)return;
      if(!data){view('home-setup');return;}
      const r=await store.client.from('households').select('id,name,monthly_budget,invite_code').eq('id',data.household_id).single();if(r.error)throw r.error;
      if(recovery.active){showRecovery();return;}
      if(store.user?.id!==userId)return;
      store.household=r.data;
    }
    view('dashboard');$('home-display').textContent=store.household.name;$('invite-code').textContent=store.household.invite_code;$('user-email').textContent=`Sesión: ${store.user.email}`;
    await refresh().catch(fail);
  })();
  routeTask={userId,promise};
  try{await promise;}finally{if(routeTask?.promise===promise)routeTask=null;}
}
async function paged(query){
  const rows=[];
  for(let offset=0;;offset+=200){
    const {data,error}=await query().range(offset,offset+199);
    if(error)throw error;
    rows.push(...(data||[]));
    if((data||[]).length<200)return rows;
  }
}
async function refresh(force=false){
  if(!store.household)return;
  const hadSnapshot=store.loaded;
  if(force){store.dataVersion++;store.loaded=false;}
  if(loadTask){
    try{await loadTask;}catch(error){if(!force)throw error;}
    if(!force&&store.loaded){render();return;}
  }
  if(store.loaded){render();return;}
  const householdId=store.household.id,version=store.dataVersion;
  $('data-status').textContent='Cargando compras…';$('refresh-data-btn').disabled=true;
  const promise=(async()=>{
    try{
      let household=store.household;
      if(force){
        const result=await store.client.from('households').select('id,name,monthly_budget,invite_code').eq('id',householdId).single();
        if(result.error)throw result.error;
        if(!result.data)throw Error('No se pudo consultar el presupuesto del hogar.');
        household=result.data;
      }
      const purchases=await paged(()=>store.client.from('purchases').select('id,store,purchased_on,total,created_at').eq('household_id',householdId).order('purchased_on',{ascending:false}).order('created_at',{ascending:false}).order('id',{ascending:false}));
      const items=[];
      for(let index=0;index<purchases.length;index+=100){
        const ids=purchases.slice(index,index+100).map(p=>p.id);
        items.push(...await paged(()=>store.client.from('purchase_items').select('id,purchase_id,name,quantity,line_total').in('purchase_id',ids).order('id',{ascending:true})));
      }
      if(store.household?.id!==householdId||store.dataVersion!==version)return;
      store.household=household;store.purchases=purchases;store.items=items;store.loaded=true;
      $('home-display').textContent=household.name;$('invite-code').textContent=household.invite_code;
      updateFilters();render();$('data-status').textContent='Compras actualizadas';
    }catch(error){
      if(store.household?.id===householdId&&store.dataVersion===version){
        store.loaded=hadSnapshot;
        $('data-status').textContent='No se pudieron actualizar los datos. '+(hadSnapshot?'La información visible puede estar desactualizada. ':'')+'Pulsa Actualizar para reintentar.';
      }
      throw error;
    }finally{$('refresh-data-btn').disabled=false;}
  })();
  loadTask=promise;
  try{await promise;}finally{if(loadTask===promise)loadTask=null;}
}
function navigate(page, resetScroll=true){
  if(!['home','history','data'].includes(page))return;
  if(resetScroll)checkCalendar();
  store.page=page;
  for(const name of ['home','history','data'])$(name+'-page').classList.toggle('hidden',name!==page);
  document.querySelectorAll('[data-page]').forEach(button=>{
    if(button.dataset.page===page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  $('screen-heading').textContent={home:'Inicio',history:'Historial',data:'Data'}[page];
  if(resetScroll){document.querySelector?.('.shell')?.scrollTo({top:0});$('screen-heading').focus?.({preventScroll:true});}
}
function updateFilters(){
  const current=monthKey(new Date());
  const months=[...new Set([current,...store.purchases.map(p=>p.purchased_on.slice(0,7)),...analytics.evolution([],new Date()).map(m=>m.month)])].sort().reverse();
  for(const id of ['history-month','data-month']){
    const previous=$(id).value;
    const followCurrent=$(id).dataset.manual!=='true'&&previous===$(id).dataset.currentMonth;
    if(previous&&!months.includes(previous))months.push(previous);
    $(id).innerHTML=(id==='history-month'?'<option value="">Todos los meses</option>':'')+months.map(month=>`<option value="${month}">${monthLabel(month)}</option>`).join('');
    $(id).value=followCurrent?current:previous!==''&&months.includes(previous)?previous:($(id).dataset.initialized==='true'&&id==='history-month'?'':current);
    $(id).dataset.initialized='true';$(id).dataset.currentMonth=current;
  }
  const supermarket=$('history-store').value;
  const supermarkets=[...new Set(store.purchases.map(p=>p.store))].sort((a,b)=>a.localeCompare(b,'es'));
  $('history-store').innerHTML='<option value="">Todos los supermercados</option>'+supermarkets.map(name=>`<option value="${safe(name)}">${safe(name)}</option>`).join('');
  $('history-store').value=supermarkets.includes(supermarket)?supermarket:'';
}
function monthLabel(month){return new Date(Number(month.slice(0,4)),Number(month.slice(5,7))-1,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'});}
function purchaseCards(purchases){
  return purchases.length?purchases.map(p=>`<button class="purchase-card" data-purchase="${p.id}"><span class="purchase-icon" aria-hidden="true">🛒</span><span class="purchase-text"><b>${safe(p.store)}</b><small>${new Date(p.purchased_on+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}</small></span><span class="purchase-price">${fmt(p.total)}</span></button>`).join(''):'<div class="empty">No hay compras para este periodo o búsqueda.</div>';
}
function render(){
  if(!store.loaded||!store.household)return;
  renderedDate=dateLocal();
  const today=new Date(),current=monthKey(today),purchases=analytics.inMonth(store.purchases,current);
  const spent=analytics.total(purchases),budget=analytics.cents(store.household.monthly_budget),remaining=budget-spent;
  $('period-heading').textContent=monthLabel(current);
  $('remaining').textContent=fmt(remaining/100);$('spent').textContent=fmt(spent/100);$('budget').textContent=fmt(budget/100);
  const percentage=budget>0?Math.min(100,spent/budget*100):spent>0?100:0;
  $('progress-bar').style.width=`${percentage}%`;
  $('progress-bar').classList.toggle('over-budget',remaining<0);
  $('budget-progress').setAttribute('aria-valuenow',String(Math.round(percentage)));
  $('budget-progress').setAttribute('aria-valuetext',`${fmt(spent/100)} gastados de ${fmt(budget/100)}`);
  $('budget-warning').classList.toggle('hidden',remaining>=0);
  const weekly=analytics.weekly(store.household.monthly_budget,store.purchases,today);
  $('weekly-amount').textContent=fmt(weekly.amount/100);
  const dateFormat={day:'numeric',month:'short'};
  $('weekly-period').textContent=`${weekly.from.toLocaleDateString('es-ES',dateFormat)} – ${weekly.to.toLocaleDateString('es-ES',dateFormat)} · ${weekly.daysThisWeek} días de este mes`;
  $('recent-purchases').innerHTML=purchaseCards(purchases.slice(0,3));
  renderHistory();renderData();navigate(store.page,false);
}
function renderHistory(){
  if(!store.loaded)return;
  const results=analytics.history(store.purchases,store.items,{month:$('history-month').value,supermarket:$('history-store').value,query:$('history-search').value});
  $('purchase-count').textContent=`${results.length} compras`;
  $('purchases-list').innerHTML=purchaseCards(results.slice(0,store.historyLimit));
  $('history-more-btn').classList.toggle('hidden',results.length<=store.historyLimit);
}
function renderData(){
  if(!store.loaded)return;
  const purchases=analytics.inMonth(store.purchases,$('data-month').value),ids=new Set(purchases.map(p=>p.id));
  const byStore=new Map(),byProduct=new Map();
  purchases.forEach(p=>byStore.set(p.store.trim(),(byStore.get(p.store.trim())||0)+analytics.cents(p.total)));
  store.items.filter(item=>ids.has(item.purchase_id)).forEach(item=>{const name=item.name.trim().toLocaleLowerCase('es');byProduct.set(name,(byProduct.get(name)||0)+analytics.cents(item.line_total));});
  report('store-report',[...byStore].sort((a,b)=>b[1]-a[1]),'No hay gastos por supermercado en este mes.');
  report('product-report',[...byProduct].sort((a,b)=>b[1]-a[1]),'No hay productos detallados en este mes.');
  report('monthly-report',analytics.evolution(store.purchases).map(m=>[monthLabel(m.month),m.total]),'');
}
function report(id,list,empty){
  const max=Math.max(1,...list.map(([,value])=>value));
  $(id).innerHTML=list.length?list.map(([name,value])=>`<div><div class="report-line"><span>${safe(name)}</span><b>${fmt(value/100)}</b></div><div class="report-meter" aria-hidden="true"><div style="width:${value>0?Math.max(2,value/max*100):0}%"></div></div></div>`).join(''):`<p class="muted">${empty}</p>`;
}
function addItem(name='',qty='1',total=''){const row=document.createElement('div');row.className='item-row';row.innerHTML=`<input class="item-name" aria-label="Producto" maxlength="120" required placeholder="Producto" value="${safe(name)}"><input class="item-qty" aria-label="Cantidad" type="number" min="0.01" step="0.01" required value="${safe(qty)}"><input class="item-total" aria-label="Subtotal del producto" type="number" min="0" step="0.01" required placeholder="€ total" value="${safe(total)}"><button type="button" class="remove-item" aria-label="Quitar producto">×</button>`;row.querySelector('button').onclick=()=>row.remove();$('items-container').appendChild(row);}
function dialog(id){$(id).showModal();}
async function reloadAfterWrite(message){
  const householdId=store.household?.id,userId=store.user?.id;
  try{await refresh(true);notice(message);}
  catch{
    if(store.household?.id!==householdId||store.user?.id!==userId)return;
    $('data-status').textContent=message+'. No se pudieron actualizar los datos del hogar; la información visible puede estar desactualizada. Pulsa Actualizar.';
    notice(message+'. Actualización pendiente; no repitas la operación.');
  }
}
async function savePurchase(ev){ev.preventDefault();const btn=$('save-purchase');if(btn.disabled)return;btn.disabled=true;
  const householdId=store.household?.id,userId=store.user?.id;
  try{const total=Number($('purchase-total').value),storeName=$('purchase-store').value.trim(),date=$('purchase-date').value;
    if(!storeName||!date||!Number.isFinite(total)||total<=0)throw Error('Completa supermercado, fecha e importe positivo.');
    const items=[...document.querySelectorAll('#items-container .item-row')].map(row=>({name:row.querySelector('.item-name').value.trim(),quantity:Number(row.querySelector('.item-qty').value),line_total:Number(row.querySelector('.item-total').value)}));
    if(items.some(i=>!i.name||i.name.length>120||!Number.isFinite(i.quantity)||i.quantity<=0||!Number.isFinite(i.line_total)||i.line_total<0))throw Error('Revisa los productos y sus precios.');
    if(items.length && Math.round(items.reduce((n,i)=>n+i.line_total,0)*100)!==Math.round(total*100))throw Error('La suma de productos debe coincidir con el total del recibo.');
    const r=await store.client.from('purchases').insert({household_id:store.household.id,created_by:store.user.id,store:storeName,purchased_on:date,total}).select('id,created_at').single();if(r.error)throw r.error;
    if(items.length){const ir=await store.client.from('purchase_items').insert(items.map(i=>({...i,purchase_id:r.data.id})));if(ir.error){await store.client.from('purchases').delete().eq('id',r.data.id);throw Error('No se pudieron guardar los productos. Revisa y repite la compra.');}}
    if(store.household?.id!==householdId||store.user?.id!==userId)return;
    store.purchases.unshift({id:r.data.id,store:storeName,purchased_on:date,total,created_at:r.data.created_at});
    store.purchases.sort((a,b)=>b.purchased_on.localeCompare(a.purchased_on)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
    store.items.push(...items.map(i=>({...i,purchase_id:r.data.id})));
    updateFilters();render();
    $('purchase-dialog').close();$('purchase-form').reset();$('items-container').innerHTML='';await reloadAfterWrite('Compra guardada ✔');
  }catch(e){fail(e);}finally{btn.disabled=false;}
}
function purchaseDetail(id){const p=store.purchases.find(x=>x.id===id);if(!p)return;store.selected=p;
  $('detail-title').textContent=p.store;$('detail-subtitle').textContent=new Date(p.purchased_on+'T12:00:00').toLocaleDateString('es-ES',{dateStyle:'long'});$('detail-total').textContent=fmt(p.total);
  const its=store.items.filter(i=>i.purchase_id===id);$('detail-items').innerHTML=its.length?its.map(i=>`<div class="detail-item"><span>${safe(i.name)} <span class="muted">×${safe(i.quantity)}</span></span><b>${fmt(i.line_total)}</b></div>`).join(''):'<p class="muted">Esta compra no tiene productos detallados.</p>';dialog('detail-dialog');
}
$('config-btn').onclick=openConfig;
$('config-cancel-btn').onclick=()=>route().catch(fail);
$('restore-config-btn').onclick=()=>{
  if(!defaultConfig())return;
  try{
    localStorage.removeItem(configOverrideKey);
    localStorage.removeItem('casa_url');localStorage.removeItem('casa_key');
    restartWithConfig();
  }catch{$('config-message').textContent='No se pudo restaurar la configuración. Comprueba los permisos de almacenamiento del navegador.';}
};
$('setup-form').onsubmit=event=>{
  event.preventDefault();
  const pair=publicConfig($('supabase-url').value,$('supabase-key').value);
  if(!pair){$('config-message').textContent='Utiliza una URL https://xxxxx.supabase.co y una clave pública sb_publishable_… del mismo proyecto.';return;}
  const defaults=defaultConfig();
  try{
    localStorage.setItem(configOverrideKey,JSON.stringify({...pair,defaultUrl:defaults?.url||'',defaultKey:defaults?.key||''}));
    localStorage.removeItem('casa_url');localStorage.removeItem('casa_key');
    restartWithConfig();
  }catch{$('config-message').textContent='No se pudo guardar la configuración. Comprueba los permisos de almacenamiento del navegador.';}
};
$('forgot-password-btn').onclick=async()=>{
  const email=$('auth-email');
  if(!email.reportValidity())return;
  const button=$('forgot-password-btn');button.disabled=true;
  $('auth-message').textContent='Enviando correo…';
  try{
    const {error}=await store.client.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:authRedirect});
    if(error)throw error;
    $('auth-message').textContent='Si existe una cuenta con ese correo, recibirás un enlace de recuperación.';
  }catch(error){$('auth-message').textContent=passwordError(error);}
  finally{button.disabled=false;}
};
$('recovery-form').onsubmit=async event=>{
  event.preventDefault();
  if(recovery.status!=='valid'){showRecovery();return;}
  const password=$('new-password').value;
  if(password!==$('confirm-password').value){recoveryMessage('Las contraseñas no coinciden.');return;}
  const button=$('save-password');recovery.busy=true;button.disabled=true;
  recoveryMessage('Guardando contraseña…');
  try{
    const {data:{session},error:sessionError}=await store.client.auth.getSession();
    if(sessionError)throw sessionError;
    if(recovery.status!=='valid' || !session?.access_token || session.user?.id!==recovery.userId){invalidRecovery();return;}
    const {error}=await store.client.auth.updateUser({password});
    if(error)throw error;
    $('recovery-form').reset();recovery.active=false;recovery.status='pending';recovery.userId=null;recovery.cancelled=true;
    history.replaceState(null,'',location.pathname+location.search);
    notice('Contraseña actualizada ✔');
    await route();
  }catch(error){
    if(confirmedAuthError(error))invalidRecovery();
    else recoveryMessage(passwordError(error,true));
  }finally{recovery.busy=false;button.disabled=recovery.status!=='valid';}
};
$('recovery-retry-btn').onclick=()=>{
  recovery.active=false;recovery.status='pending';recovery.userId=null;recovery.cancelled=true;
  $('recovery-form').reset();$('auth-password').value='';
  history.replaceState(null,'',location.pathname);
  $('auth-message').textContent='Introduce tu email y pulsa «Olvidé mi contraseña» para solicitar otro enlace.';
  view('auth');$('auth-email').focus();
};
$('auth-form').onsubmit=async e=>{e.preventDefault();try{const r=await store.client.auth.signInWithPassword({email:$('auth-email').value.trim(),password:$('auth-password').value});if(r.error)throw r.error;store.user=r.data.user;await route();}catch(e){fail(e);}};
$('signup-btn').onclick=async()=>{try{const r=await store.client.auth.signUp({email:$('auth-email').value.trim(),password:$('auth-password').value,options:{emailRedirectTo:'https://jozeless.github.io/casa-budget/'}});if(r.error)throw r.error;if(r.data.session){store.user=r.data.user;await route();}else notice('Cuenta creada. Confirma tu email antes de entrar.');}catch(e){fail(e);}};
$('create-home-form').onsubmit=async e=>{e.preventDefault();try{const r=await store.client.rpc('create_my_household',{p_name:$('home-name').value.trim(),p_budget:Number($('initial-budget').value)});if(r.error)throw r.error;await route();notice('Hogar creado ✔');}catch(e){fail(e);}};
$('join-home-form').onsubmit=async e=>{e.preventDefault();try{const r=await store.client.rpc('join_my_household',{p_invite_code:$('join-code').value.trim()});if(r.error)throw r.error;await route();notice('Ya compartís hogar ✔');}catch(e){fail(e);}};
$('logout-btn').onclick=async()=>{const r=await store.client.auth.signOut();if(r.error)fail(r.error);else{store.user=null;store.household=null;store.loaded=false;store.dataVersion++;store.purchases=[];store.items=[];resetDashboard();view('auth');}};
document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>navigate(button.dataset.page));
$('see-history-btn').onclick=()=>navigate('history');
$('add-menu-btn').onclick=()=>dialog('add-menu-dialog');
$('refresh-data-btn').onclick=()=>refresh(true).catch(fail);
for(const id of ['history-month','history-store'])$(id).onchange=()=>{if(id==='history-month')$(id).dataset.manual='true';store.historyLimit=50;renderHistory();};
$('history-search').oninput=()=>{store.historyLimit=50;renderHistory();};
$('data-month').onchange=()=>{$('data-month').dataset.manual='true';renderData();};
$('history-more-btn').onclick=()=>{store.historyLimit+=50;renderHistory();};
$('new-purchase-btn').onclick=()=>{$('add-menu-dialog').close();$('purchase-form').reset();$('purchase-date').value=dateLocal();$('items-container').innerHTML='';dialog('purchase-dialog');};
$('new-budget-btn').onclick=()=>{$('budget-input').value=store.household.monthly_budget;dialog('budget-dialog');};
$('add-item-btn').onclick=()=>addItem();
$('purchase-form').onsubmit=savePurchase;
$('budget-form').onsubmit=async e=>{e.preventDefault();try{const amount=Number($('budget-input').value);if(!Number.isFinite(amount)||amount<0)throw Error('Presupuesto inválido');const r=await store.client.from('households').update({monthly_budget:amount}).eq('id',store.household.id).select('monthly_budget').single();if(r.error)throw r.error;store.household.monthly_budget=r.data.monthly_budget;$('budget-dialog').close();render();notice('Presupuesto actualizado');}catch(err){fail(err);}};
for(const id of ['purchases-list','recent-purchases'])$(id).onclick=e=>{const card=e.target.closest('[data-purchase]');if(card)purchaseDetail(card.dataset.purchase);};
$('delete-purchase').onclick=async()=>{
  const button=$('delete-purchase'),purchase=store.selected;
  if(button.disabled||!purchase||!confirm(`¿Eliminar la compra de ${purchase.store}?`))return;
  button.disabled=true;
  const householdId=store.household?.id,userId=store.user?.id;
  try{
    const r=await store.client.from('purchases').delete().eq('id',purchase.id);if(r.error)throw r.error;
    if(store.household?.id!==householdId||store.user?.id!==userId)return;
    store.purchases=store.purchases.filter(p=>p.id!==purchase.id);
    store.items=store.items.filter(i=>i.purchase_id!==purchase.id);store.selected=null;
    updateFilters();render();$('detail-dialog').close();await reloadAfterWrite('Compra eliminada');
  }catch(e){fail(e);}finally{button.disabled=false;}
};
$('copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText(store.household.invite_code);notice('Código copiado');}catch(e){notice('Selecciona el código y cópialo manualmente.');}};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(console.warn);
document.addEventListener?.('visibilitychange',()=>{if(!document.hidden)resumeCalendar();});
window.addEventListener?.('pageshow',resumeCalendar);
window.addEventListener?.('focus',resumeCalendar);
scheduleCalendar();
start().catch(fail);
})();
