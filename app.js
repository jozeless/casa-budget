(() => {
'use strict';
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('es-NL', {style:'currency',currency:'EUR'}).format(Number(n)||0);
const dateLocal = () => {const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const safe = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const store = {client:null,user:null,household:null,purchases:[],items:[],adjustments:[],receipts:[],selected:null,loaded:false,dataVersion:0,page:'home',historyLimit:50};
const analytics=window.CASA_BUDGET;
let loadTask=null;
let routeTask=null;
const dataView={tab:'summary',shop:null,storeLimit:50,productLimit:50,purchaseLimit:50};
let dataCache=null;
let editingPurchase=null;
let phase2Ready=true;
let productRows=[],productName='',productEpoch=0;
const pendingKey=()=>`casa_pending_purchase_${store.user?.id}_${store.household?.id}`;
function pendingWrite(){return JSON.parse(localStorage.getItem(pendingKey())||'null');}
function phaseError(error){
  if(error?.code==='PGRST202'||error?.code==='42703')return 'Falta aplicar la migración de Fase 2 en Supabase. Contacta con quien administra CASA.';
  return error?.message||'No se pudo conectar. Intenta nuevamente.';
}
const receiptUI=window.CASA_RECEIPT_UI?.({getStore:()=>store,notice:msg=>notice(msg),duplicateApproval,applySaved,reloadAfterWrite,refresh});
function applySaved(saved){
 const known=store.purchases.find(p=>p.id===saved.purchase.id);if(known&&Number(known.revision)>Number(saved.purchase.revision))return;
 store.purchases=store.purchases.filter(p=>p.id!==saved.purchase.id).concat(saved.purchase);
 store.purchases.sort((a,b)=>b.purchased_on.localeCompare(a.purchased_on)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
 store.items=store.items.filter(i=>i.purchase_id!==saved.purchase.id).concat(saved.items);
 store.adjustments=store.adjustments.filter(a=>a.purchase_id!==saved.purchase.id).concat(saved.adjustments||[]);
 if(saved.receipt)store.receipts=store.receipts.filter(r=>r.id!==saved.receipt.id).concat(saved.receipt);
 productEpoch++;updateFilters();render();
}
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
  receiptUI?.reset();store.adjustments=[];store.receipts=[];if(receiptUI){$('data-adjustments-note').textContent='';$('detail-adjustments').innerHTML='';$('view-receipt').classList.add('hidden');}
  for(const id of ['remaining','spent','budget','settings-budget','weekly-amount'])$(id).textContent='—';
  for(const id of ['purchases-list','store-report','product-report','monthly-report'])$(id).innerHTML='';
  $('purchase-count').textContent='';$('weekly-period').textContent='';$('progress-bar').style.width='0%';
  $('budget-warning').classList.add('hidden');$('budget-zero').classList.add('hidden');
  delete $('budget-progress').dataset.level;
  $('budget-progress').setAttribute('aria-valuenow','0');$('budget-progress').setAttribute('aria-valuetext','Presupuesto pendiente de actualizar');
  for(const id of ['history-month','history-store','history-search','data-month']){
    $(id).value='';if($(id).dataset){delete $(id).dataset.initialized;delete $(id).dataset.manual;delete $(id).dataset.currentMonth;}
  }
  store.page='home';store.historyLimit=50;
  dataCache=null;dataView.tab='summary';dataView.shop=null;dataView.storeLimit=50;dataView.productLimit=50;dataView.purchaseLimit=50;
  $('data-product-search').value='';$('data-evolution').value='monthly';
  for(const id of ['data-total','data-count','data-average','data-used'])$(id).textContent='—';
  $('data-store-purchases').innerHTML='';$('data-empty').classList.add('hidden');
  for(const id of ['data-budget-note','data-product-count','data-evolution-note','data-store-title'])$(id).textContent='';
  $('data-store-detail').classList.add('hidden');
  selectDataTab('summary');
  for(const id of ['purchase-dialog','detail-dialog','budget-dialog','add-menu-dialog','product-dialog','duplicate-dialog'])if($(id).open)$(id).close();
}
const view = name => {
  ['setup','auth','recovery','home-setup','dashboard'].forEach(v=>$(v+'-view').classList.toggle('hidden',v!==name));
  const showNav=name==='dashboard'&&!!store.household&&!recovery.active;
  $('refresh-data-btn').classList.toggle('hidden',!showNav);
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
function dataStatus(message){
  $('data-status').textContent=message;
  $('data-status').classList.toggle('sr-only',message==='Compras actualizadas');
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
  dataStatus('Cargando compras…');$('refresh-data-btn').disabled=true;
  const promise=(async()=>{
    try{
      let household=store.household;
      if(force){
        const result=await store.client.from('households').select('id,name,monthly_budget,invite_code').eq('id',householdId).single();
        if(result.error)throw result.error;
        if(!result.data)throw Error('No se pudo consultar el presupuesto del hogar.');
        household=result.data;
      }
      const purchaseQuery=columns=>store.client.from('purchases').select(columns).eq('household_id',householdId).order('purchased_on',{ascending:false}).order('created_at',{ascending:false}).order('id',{ascending:false});
      let purchases,ready=true;
      try{purchases=await paged(()=>purchaseQuery('id,store,purchased_on,total,created_at,revision'));}
      catch(error){
        if(error.code!=='42703')throw error;
        ready=false;purchases=await paged(()=>purchaseQuery('id,store,purchased_on,total,created_at'));
      }
      const items=[];
      for(let index=0;index<purchases.length;index+=100){
        const ids=purchases.slice(index,index+100).map(p=>p.id);
        items.push(...await paged(()=>store.client.from('purchase_items').select('id,purchase_id,name,quantity,line_total').in('purchase_id',ids).order('id',{ascending:true})));
      }
      const adjustments=[];
      if(receiptUI){
       for(let index=0;index<purchases.length;index+=100){
        try{adjustments.push(...await paged(()=>store.client.from('purchase_adjustments').select('id,purchase_id,kind,description,amount_cents,item_id').in('purchase_id',purchases.slice(index,index+100).map(p=>p.id)).order('id')));}
        catch(error){if(['PGRST205','42P01'].includes(error.code))break;throw error;}
       }
      }
      if(store.household?.id!==householdId||store.dataVersion!==version)return;
      let receipts=[];if(receiptUI){try{receipts=await paged(()=>store.client.from('purchase_receipts').select('id,purchase_id,path,status').eq('household_id',householdId).order('id'));}catch(error){if(!['PGRST205','42P01'].includes(error.code))throw error;}}
      if(store.household?.id!==householdId||store.dataVersion!==version)return;
      store.adjustments=adjustments;store.receipts=receipts;
      phase2Ready=ready;store.household=household;store.purchases=purchases;store.items=items;store.loaded=true;
      $('home-display').textContent=household.name;$('invite-code').textContent=household.invite_code;
      updateFilters();render();dataStatus(phase2Ready?'Compras actualizadas':'Compras actualizadas. Falta la migración de Fase 2 para guardar o editar compras.');
    }catch(error){
      if(store.household?.id===householdId&&store.dataVersion===version){
        store.loaded=hadSnapshot;
        dataStatus('No se pudieron actualizar los datos. '+(hadSnapshot?'La información visible puede estar desactualizada. ':'')+'Pulsa Actualizar para reintentar.');
      }
      throw error;
    }finally{$('refresh-data-btn').disabled=false;}
  })();
  loadTask=promise;
  try{await promise;}finally{if(loadTask===promise)loadTask=null;}
}
function navigate(page, resetScroll=true){
  if(!['home','history','data','settings'].includes(page))return;
  if(resetScroll)checkCalendar();
  store.page=page;
  for(const name of ['home','history','data','settings'])$(name+'-page').classList.toggle('hidden',name!==page);
  document.querySelectorAll('[data-page]').forEach(button=>{
    if(button.dataset.page===page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  $('screen-heading').textContent={home:'Inicio',history:'Historial',data:'Data',settings:'Settings'}[page];
  if(resetScroll){document.querySelector?.('.shell')?.scrollTo({top:0});$('screen-heading').focus?.({preventScroll:true});}
}
function updateFilters(){
  const current=monthKey(new Date());
  const months=[...new Set([current,...store.purchases.map(p=>p.purchased_on.slice(0,7)),...analytics.evolution([],new Date()).map(m=>m.month)])].sort().reverse();
  for(const id of ['history-month','data-month']){
    const previous=$(id).value;
    const followCurrent=$(id).dataset.manual!=='true'&&previous===$(id).dataset.currentMonth;
    const choices=id==='data-month'?analytics.dataMonths(store.purchases,current,previous):months;
    if(previous&&!choices.includes(previous))choices.push(previous);
    $(id).innerHTML=(id==='history-month'?'<option value="">Todos los meses</option>':'')+choices.map(month=>`<option value="${month}">${monthLabel(month)}</option>`).join('');
    $(id).value=followCurrent?current:previous!==''&&choices.includes(previous)?previous:($(id).dataset.initialized==='true'&&id==='history-month'?'':current);
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
  const availability=analytics.remainingBudget(budget/100,spent/100);
  $('settings-budget').textContent=fmt(budget/100);
  $('progress-bar').style.width=`${availability.percentage}%`;
  $('budget-progress').dataset.level=availability.level;
  $('budget-zero').classList.toggle('hidden',!availability.zeroBudget);
  $('budget-progress').setAttribute('aria-valuenow',String(Math.round(availability.percentage)));
  $('budget-progress').setAttribute('aria-valuetext',`${availability.zeroBudget?'Sin presupuesto mensual. ':''}${fmt(remaining/100)} disponibles de ${fmt(budget/100)}; ${fmt(spent/100)} gastados`);
  $('budget-warning').classList.toggle('hidden',remaining>=0);
  const weekly=analytics.weekly(store.household.monthly_budget,store.purchases,today);
  $('weekly-amount').textContent=fmt(weekly.amount/100);
  const dateFormat={day:'numeric',month:'short'};
  $('weekly-period').textContent=`${weekly.from.toLocaleDateString('es-ES',dateFormat)} – ${weekly.to.toLocaleDateString('es-ES',dateFormat)} · ${weekly.daysThisWeek} días de este mes`;
  renderHistory();
  if(store.loaded){const model=dataModel();renderDataStores(model);renderDataProducts(model);}
  renderData();navigate(store.page,false);
}
function renderHistory(){
  if(!store.loaded)return;
  const results=analytics.history(store.purchases,store.items,{month:$('history-month').value,supermarket:$('history-store').value,query:$('history-search').value});
  $('purchase-count').textContent=`${results.length} compras`;
  $('purchases-list').innerHTML=purchaseCards(results.slice(0,store.historyLimit));
  $('history-more-btn').classList.toggle('hidden',results.length<=store.historyLimit);
}
function dataModel(){
  const month=$('data-month').value,budget=store.household.monthly_budget;
  if(!dataCache||dataCache.month!==month||dataCache.budget!==budget||dataCache.purchases!==store.purchases||dataCache.items!==store.items||dataCache.adjustments!==store.adjustments){
    dataCache={month,budget,purchases:store.purchases,items:store.items,adjustments:store.adjustments,model:analytics.dataIntelligence(store.purchases,store.items,month,budget,store.adjustments)};
  }
  return dataCache.model;
}
const percentage=value=>new Intl.NumberFormat('es-ES',{maximumFractionDigits:1}).format(value)+' %';
function selectDataTab(tab,focus=false){
  if(!['summary','stores','products'].includes(tab))return;
  dataView.tab=tab;
  document.querySelectorAll('[data-data-tab]').forEach(button=>{
    const selected=button.dataset.dataTab===tab;
    button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
    if(selected&&focus)button.focus();
  });
  for(const name of ['summary','stores','products'])$('data-'+name+'-panel').classList.toggle('hidden',name!==tab);
  renderData();
}
function renderData(){
  if(!store.loaded||!store.household)return;
  const model=dataModel(),summary=model.summary;
  $('data-total').textContent=fmt(summary.spent/100);$('data-count').textContent=String(summary.count);
  $('data-average').textContent=summary.average===null?'Sin compras':fmt(summary.average/100);
  $('data-used').textContent=summary.used===null?'No aplicable':percentage(summary.used);
  $('data-empty').classList.toggle('hidden',summary.count!==0);
  $('data-budget-note').textContent=$('data-month').value===monthKey(new Date())?'Comparación con el presupuesto mensual vigente.':'Este mes se compara con el presupuesto mensual actual, no con un presupuesto histórico.';
  if(dataView.tab==='summary'){
    const weekly=$('data-evolution').value==='weekly';
    const dateLabel=value=>{const [y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('es-ES',{day:'numeric',month:'short'});};
    const values=weekly?model.weekly.map(w=>[`${dateLabel(w.from)} – ${dateLabel(w.to)}`,w.total]):model.monthly.map(m=>[monthLabel(m.month),m.total]);
    $('data-evolution-note').textContent=weekly?'Semanas de lunes a domingo; solo se cuentan compras del mes seleccionado.':'Seis meses consecutivos hasta el mes seleccionado, incluidos los meses sin compras.';
    report('monthly-report',values,'');
  }else if(dataView.tab==='stores')renderDataStores(model);
  else renderDataProducts(model);
}
function dataRows(id,entries,type,empty){
  const max=entries.reduce((n,e)=>Math.max(n,e.total),1);
  $(id).innerHTML=entries.length?entries.map(entry=>`<button type="button" class="product-link" data-${type}="${safe(entry.key)}"><span class="report-line"><span>${safe(entry.name)}</span><b>${fmt(entry.total/100)}</b></span><span class="hint">${type==='store'?percentage(entry.percentage)+' del gasto del mes':entry.count+(entry.count===1?' compra distinta':' compras distintas')+(entry.attributed?' · Ajustes atribuibles: '+fmt(entry.attributed/100):'')}</span><span class="report-meter" aria-hidden="true"><span style="width:${entry.total>0?Math.max(2,entry.total/max*100):0}%"></span></span></button>`).join(''):`<p class="muted">${empty}</p>`;
}
function renderDataStores(model){
  dataRows('store-report',model.stores.slice(0,dataView.storeLimit),'store','No hay gastos por supermercado en este mes.');
  $('data-stores-more').classList.toggle('hidden',model.stores.length<=dataView.storeLimit);
  const selected=model.stores.find(s=>s.key===dataView.shop);
  $('data-store-detail').classList.toggle('hidden',!selected);
  $('data-store-title').textContent=selected?selected.name:'';
  $('data-store-purchases').innerHTML=selected?purchaseCards(selected.purchases.slice(0,dataView.purchaseLimit)):'';
  $('data-store-more').classList.toggle('hidden',!selected||selected.purchases.length<=dataView.purchaseLimit);
}
function renderDataProducts(model){
  if(receiptUI)$('data-adjustments-note').textContent=model.generalAdjustments?'Los productos conservan sus importes brutos. Ajustes generales: '+fmt(model.generalAdjustments/100)+'. No se reparten entre productos; el total pagado puede diferir de su suma.':'Los descuentos atribuibles se muestran separados; los totales generales y por tienda representan lo pagado.';
  const query=analytics.normalize($('data-product-search').value);
  const products=model.products.filter(p=>analytics.normalize(p.name).includes(query));
  $('data-product-count').textContent=`${products.length} productos`;
  dataRows('product-report',products.slice(0,dataView.productLimit),'product',model.products.length?'No hay productos que coincidan con la búsqueda.':'No hay productos detallados en este mes.');
  $('data-products-more').classList.toggle('hidden',products.length<=dataView.productLimit);
}
$('store-report').onclick=event=>{const button=event.target.closest('[data-store]');if(!button||!store.loaded)return;dataView.shop=button.dataset.store;dataView.purchaseLimit=50;renderDataStores(dataModel());};
$('data-store-purchases').onclick=event=>{const card=event.target.closest('[data-purchase]');if(card)purchaseDetail(card.dataset.purchase);};
$('data-evolution').onchange=renderData;
$('data-product-search').oninput=()=>{dataView.productLimit=50;if(store.loaded)renderDataProducts(dataModel());};
$('data-products-more').onclick=()=>{dataView.productLimit+=50;renderData();};
$('data-stores-more').onclick=()=>{dataView.storeLimit+=50;renderData();};
$('data-store-more').onclick=()=>{dataView.purchaseLimit+=50;renderData();};
document.querySelectorAll('[data-data-tab]').forEach(button=>{
  button.onclick=()=>selectDataTab(button.dataset.dataTab);
  button.onkeydown=event=>{
    const names=['summary','stores','products'];let index=names.indexOf(dataView.tab);
    if(event.key==='ArrowRight')index=(index+1)%3;else if(event.key==='ArrowLeft')index=(index+2)%3;else if(event.key==='Home')index=0;else if(event.key==='End')index=2;else return;
    event.preventDefault();selectDataTab(names[index],true);
  };
});
function report(id,list,empty){
  const max=list.reduce((value,[,amount])=>Math.max(value,amount),1);
  $(id).innerHTML=list.length?list.map(([name,value])=>{
    const product=id==='product-report',tag=product?'span':'div';
    const content=`<${tag} class="report-line"><span>${safe(name)}</span><b>${fmt(value/100)}</b></${tag}><${tag} class="report-meter" aria-hidden="true"><${tag} style="width:${value>0?Math.max(2,value/max*100):0}%"></${tag}></${tag}>`;
    return product?`<button type="button" class="product-link" data-product="${safe(name)}">${content}</button>`:`<div>${content}</div>`;
  }).join(''):`<p class="muted">${empty}</p>`;
}
function addItem(name='',qty='1',total=''){const row=document.createElement('div');row.className='item-row';row.innerHTML=`<input class="item-name" aria-label="Producto" maxlength="120" required placeholder="Producto" value="${safe(name)}"><input class="item-qty" aria-label="Cantidad" type="number" min="0.01" step="0.01" required value="${safe(qty)}"><input class="item-total" aria-label="Subtotal del producto" type="number" min="0" step="0.01" required placeholder="€ total" value="${safe(total)}"><button type="button" class="remove-item" aria-label="Quitar producto">×</button>`;row.querySelector('button').onclick=()=>row.remove();$('items-container').appendChild(row);}
function dialog(id){$(id).showModal();}
async function reloadAfterWrite(message){
  const householdId=store.household?.id,userId=store.user?.id;
  try{await refresh(true);notice(message);}
  catch{
    if(store.household?.id!==householdId||store.user?.id!==userId)return;
    dataStatus(message+'. No se pudieron actualizar los datos del hogar; la información visible puede estar desactualizada. Pulsa Actualizar.');
    notice(message+'. Actualización pendiente; no repitas la operación.');
  }
}
function duplicateApproval(){
  return new Promise(resolve=>{
    const box=$('duplicate-dialog');
    const finish=value=>{box.close();resolve(value);};
    $('duplicate-cancel').onclick=()=>finish(false);$('duplicate-save').onclick=()=>finish(true);
    box.oncancel=event=>{event.preventDefault();finish(false);};box.showModal();
  });
}
function openPurchase(purchase=null){
  if(receiptUI&&localStorage.getItem(`casa_pending_receipt_${store.user?.id}_${store.household?.id}`))throw Error('Hay una compra de recibo pendiente. Abre Subir recibo y reintenta antes de registrar otra.');
  const pending=pendingWrite();editingPurchase=purchase;
  $('purchase-form').reset();$('items-container').innerHTML='';
  let rows=[];
  if(pending){
    const params=pending.params;
    if(params.p_purchase_id&&purchase?.id!==params.p_purchase_id){notice('Hay una edición pendiente. Abre esa compra para reintentar.');return;}
    if(!params.p_purchase_id&&purchase){notice('Hay una compra nueva pendiente. Pulsa + para reintentar.');return;}
    $('purchase-store').value=params.p_store;$('purchase-date').value=params.p_date;$('purchase-total').value=params.p_total;rows=params.p_items;
    $('purchase-title').textContent='Reintentar operación pendiente';
  }else{
    $('purchase-store').value=purchase?.store||'';$('purchase-date').value=purchase?.purchased_on||dateLocal();$('purchase-total').value=purchase?.total||'';
    rows=purchase?store.items.filter(item=>item.purchase_id===purchase.id):[];
    $('purchase-title').textContent=purchase?'Editar compra':'Registrar compra';
  }
  rows.forEach(item=>addItem(item.name,item.quantity,item.line_total));
  $('save-purchase').textContent=pending?'Reintentar guardado':purchase?'Guardar cambios':'Guardar compra';
  dialog('purchase-dialog');
}
async function savePurchase(ev){
  ev.preventDefault();const btn=$('save-purchase');if(btn.disabled)return;btn.disabled=true;
  const householdId=store.household?.id,userId=store.user?.id,key=pendingKey();let operation;
  try{
    if(!phase2Ready)throw Error('Falta aplicar la migración de Fase 2 en Supabase para guardar o editar compras.');
    const total=Number($('purchase-total').value),storeName=$('purchase-store').value.trim(),date=$('purchase-date').value;
    if(!storeName||storeName.length>80||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(total)||total<=0||total>9999999999.99||Math.abs(total*100-Math.round(total*100))>0.00001)throw Error('Completa supermercado, fecha e importe positivo.');
    const items=[...document.querySelectorAll('#items-container .item-row')].map(row=>({name:row.querySelector('.item-name').value.trim(),quantity:Number(row.querySelector('.item-qty').value),line_total:Number(row.querySelector('.item-total').value)}));
    if(items.some(i=>!i.name||i.name.length>120||!Number.isFinite(i.quantity)||i.quantity<=0||i.quantity>9999999.99||Math.abs(i.quantity*100-Math.round(i.quantity*100))>0.00001||!Number.isFinite(i.line_total)||i.line_total<0||i.line_total>9999999999.99||Math.abs(i.line_total*100-Math.round(i.line_total*100))>0.00001))throw Error('Revisa los productos y sus precios.');
    if(items.length&&items.reduce((n,i)=>n+analytics.cents(i.line_total),0)!==analytics.cents(total))throw Error('La suma de productos debe coincidir con el total del recibo.');
    const payload={p_household_id:householdId,p_purchase_id:editingPurchase?.id||null,p_expected_revision:editingPurchase?.revision??null,p_store:storeName,p_date:date,p_total:total,p_items:items};
    operation=pendingWrite();
    if(operation){
      const {p_operation_id,...original}=operation.params;
      // A lost response must be retried with exactly the original request, even after reload.
      if(JSON.stringify({...payload,p_expected_revision:original.p_expected_revision})!==JSON.stringify(original))throw Error('Hay un guardado pendiente. Reintenta con los datos originales antes de cambiarlos.');
    }else{
      if(!editingPurchase){
        const candidates=await paged(()=>store.client.from('purchases').select('id,store,total').eq('household_id',householdId).eq('purchased_on',date).eq('total',total).order('id'));
        if(candidates.some(p=>analytics.productKey(p.store)===analytics.productKey(storeName))&&!await duplicateApproval())return;
      }
      operation={params:{...payload,p_operation_id:window.crypto.randomUUID()}};
      // Persist before sending; if storage fails, do not risk an untrackable write.
      localStorage.setItem(key,JSON.stringify(operation));
    }
    const result=await store.client.rpc('casa_save_purchase',operation.params);
    if(result.error){
      if(['42501','40001','P0001','PGRST202'].includes(result.error.code)||/^(22|23)/.test(result.error.code||''))localStorage.removeItem(key);
      if(result.error.code==='40001')await refresh(true).catch(()=>{});
      throw result.error;
    }
    const saved=result.data;
    localStorage.removeItem(key);
    if(store.household?.id!==householdId||store.user?.id!==userId)return;
    store.purchases=store.purchases.filter(p=>p.id!==saved.purchase.id);store.purchases.push(saved.purchase);
    store.purchases.sort((a,b)=>b.purchased_on.localeCompare(a.purchased_on)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
    store.items=store.items.filter(i=>i.purchase_id!==saved.purchase.id).concat(saved.items);
    productEpoch++;updateFilters();render();
    $('purchase-dialog').close();$('purchase-form').reset();$('items-container').innerHTML='';editingPurchase=null;
    await reloadAfterWrite(payload.p_purchase_id?'Compra actualizada ✔':'Compra guardada ✔');
  }catch(error){
    notice(phaseError(error)+(operation&&localStorage.getItem(key)?' Guardado pendiente: reintenta; no registres otra compra.':''));
  }finally{btn.disabled=false;}
}
async function loadProductHistory(){
  const name=productName,householdId=store.household?.id,userId=store.user?.id,epoch=++productEpoch;
  productRows=[];
  $('product-status').textContent='Cargando historial…';$('product-retry').disabled=true;
  $('product-summary').textContent='';$('product-history').innerHTML='';
  try{
    const rows=await paged(()=>store.client.rpc('casa_product_history',{p_household_id:householdId,p_name:name}).order('purchased_on',{ascending:false}).order('purchase_id').order('id'));
    if(epoch!==productEpoch||store.household?.id!==householdId||store.user?.id!==userId)return;
    productRows=rows;const previous=$('product-month').value;
    const months=[...new Set([...(previous?[previous]:[]),...rows.map(r=>r.purchased_on.slice(0,7))])].sort().reverse();
    $('product-month').innerHTML='<option value="">Todo</option>'+months.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');$('product-month').value=previous;
    $('product-status').textContent='Historial actualizado';renderProductHistory();
  }catch(error){if(epoch===productEpoch)$('product-status').textContent=phaseError(error);}
  finally{if(epoch===productEpoch)$('product-retry').disabled=false;}
}
function renderProductHistory(){
  const report=analytics.productHistory(productRows,$('product-month').value);
  $('product-summary').textContent=`${fmt(report.total/100)} · ${report.count} compras`+(receiptUI?' · Importes de producto registrados; consulta descuentos y ajustes en el detalle de cada compra.':'');
  $('product-history').innerHTML=report.lines.length?report.lines.map(row=>`<div class="product-entry"><b>${safe(row.name)}</b><p>${safe(row.purchased_on)} · ${safe(row.store)}</p><p>Cantidad: ${safe(row.quantity)} · Importe pagado: ${fmt(row.line_total)}</p><button type="button" class="secondary" data-original="${row.purchase_id}">Ver compra original</button></div>`).join(''):'<p class="muted">No hay registros para este periodo.</p>';
}
$('product-report').onclick=event=>{const button=event.target.closest('[data-product]');if(!button)return;productName=button.dataset.product;$('product-title').textContent=productName;$('product-month').innerHTML=`<option value="${$('data-month').value}">${monthLabel($('data-month').value)}</option>`;$('product-month').value=$('data-month').value;dialog('product-dialog');loadProductHistory();};
$('product-month').onchange=renderProductHistory;$('product-retry').onclick=loadProductHistory;
$('product-history').onclick=async event=>{
  const button=event.target.closest('[data-original]');if(!button)return;
  try{await refresh(true);if(!store.purchases.some(p=>p.id===button.dataset.original))throw Error('Esta compra ya no está disponible.');$('product-dialog').close();purchaseDetail(button.dataset.original);}catch(error){notice(phaseError(error));}
};
$('edit-purchase').onclick=async()=>{try{if(receiptUI&&await receiptUI.edit(store.selected))return;$('detail-dialog').close();openPurchase(store.selected);}catch(error){notice(phaseError(error));}};
if(receiptUI)$('view-receipt').onclick=()=>receiptUI.showOriginal(store.selected).catch(error=>notice(error.message));
function purchaseDetail(id){const p=store.purchases.find(x=>x.id===id);if(!p)return;store.selected=p;
  $('detail-title').textContent=p.store;$('detail-subtitle').textContent=new Date(p.purchased_on+'T12:00:00').toLocaleDateString('es-ES',{dateStyle:'long'});$('detail-total').textContent=fmt(p.total);
  if(receiptUI){$('view-receipt').classList.toggle('hidden',!store.receipts.some(r=>r.purchase_id===id&&r.path));$('detail-adjustments').innerHTML=store.adjustments.filter(a=>a.purchase_id===id).map(a=>`<p>${safe(a.description)}: <b>${fmt(a.amount_cents/100)}</b> ${a.item_id?'(atribuible a producto)':'(general)'}</p>`).join('');}
  const its=store.items.filter(i=>i.purchase_id===id);$('detail-items').innerHTML=its.length?its.map(i=>`<div class="detail-item"><span>${safe(i.name)} <span class="muted">×${safe(i.quantity)}</span></span><b>${fmt(i.line_total)}</b></div>`).join(''):'<p class="muted">Esta compra no tiene productos detallados.</p>';dialog('detail-dialog');
}
$('config-btn').onclick=openConfig;
$('auth-config-btn').onclick=openConfig;
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
$('add-menu-btn').onclick=()=>dialog('add-menu-dialog');
$('refresh-data-btn').onclick=()=>refresh(true).catch(fail);
for(const id of ['history-month','history-store'])$(id).onchange=()=>{if(id==='history-month')$(id).dataset.manual='true';store.historyLimit=50;renderHistory();};
$('history-search').oninput=()=>{store.historyLimit=50;renderHistory();};
$('data-month').onchange=()=>{$('data-month').dataset.manual='true';dataView.shop=null;dataView.storeLimit=50;dataView.productLimit=50;dataView.purchaseLimit=50;renderData();};
$('history-more-btn').onclick=()=>{store.historyLimit+=50;renderHistory();};
$('new-purchase-btn').onclick=()=>{try{$('add-menu-dialog').close();openPurchase();}catch(error){notice(phaseError(error));}};
$('new-budget-btn').onclick=()=>{$('budget-input').value=store.household.monthly_budget;dialog('budget-dialog');};
$('add-item-btn').onclick=()=>addItem();
$('purchase-form').onsubmit=savePurchase;
$('budget-form').onsubmit=async e=>{e.preventDefault();try{const amount=Number($('budget-input').value);if(!Number.isFinite(amount)||amount<0)throw Error('Presupuesto inválido');const r=await store.client.from('households').update({monthly_budget:amount}).eq('id',store.household.id).select('monthly_budget').single();if(r.error)throw r.error;store.household.monthly_budget=r.data.monthly_budget;$('budget-dialog').close();render();notice('Presupuesto actualizado');}catch(err){fail(err);}};
for(const id of ['purchases-list'])$(id).onclick=e=>{const card=e.target.closest('[data-purchase]');if(card)purchaseDetail(card.dataset.purchase);};
$('delete-purchase').onclick=async()=>{
  const button=$('delete-purchase'),purchase=store.selected;
  if(button.disabled||!purchase||!confirm(`¿Eliminar la compra de ${purchase.store}?`))return;
  button.disabled=true;
  const householdId=store.household?.id,userId=store.user?.id;
  try{
    const r=await store.client.from('purchases').delete().eq('id',purchase.id);if(r.error)throw r.error;
    if(store.household?.id!==householdId||store.user?.id!==userId)return;
    store.purchases=store.purchases.filter(p=>p.id!==purchase.id);
    store.items=store.items.filter(i=>i.purchase_id!==purchase.id);store.adjustments=store.adjustments.filter(a=>a.purchase_id!==purchase.id);store.selected=null;productEpoch++;
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
