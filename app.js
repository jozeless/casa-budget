(() => {
'use strict';
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('es-NL', {style:'currency',currency:'EUR'}).format(Number(n)||0);
const dateLocal = () => {const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const safe = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const store = {client:null, user:null, household:null, month:new Date(new Date().getFullYear(),new Date().getMonth(),1), purchases:[], items:[], selected:null};
const view = name => ['setup','auth','recovery','home-setup','dashboard'].forEach(v => $(v+'-view').classList.toggle('hidden',v!==name));
let toastTimer;
const notice = msg => {const el=$('toast'); el.textContent=msg;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),4500);};
const fail = err => {notice('Error: '+(err?.message||'Intenta nuevamente'));};
const clientConfig = () => {const c=window.CASA_CONFIG||{};return {url:(c.supabaseUrl||localStorage.getItem('casa_url')||'').trim(),key:(c.supabaseAnonKey||localStorage.getItem('casa_key')||'').trim()};};
const authRedirect = 'https://jozeless.github.io/casa-budget/';
// Read only link metadata; the SDK handles credentials and session creation.
const linkParams = new URLSearchParams(location.hash.slice(1));
const linkQuery = new URLSearchParams(location.search);
const linkError = linkParams.has('error') || linkParams.has('error_code') || linkQuery.has('error') || linkQuery.has('error_code');
const recovery = {active:linkParams.get('type')==='recovery' || linkQuery.get('type')==='recovery' || linkError, valid:false};
let authSubscription;
const recoveryMessage = message => { $('recovery-message').textContent=message; };
function showRecovery(){
  view('recovery');
  $('save-password').disabled=!recovery.valid;
}
function invalidRecovery(){
  recovery.active=true; recovery.valid=false;
  $('recovery-form').reset();
  recoveryMessage('El enlace ha caducado o no es válido. Solicita un nuevo correo de recuperación.');
  showRecovery();
}
function passwordError(error, changingPassword=false){
  if(error?.status===429 || error?.code==='over_email_send_rate_limit' || error?.code==='over_request_rate_limit') return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  if(error?.code==='weak_password' || error?.code==='same_password' || (changingPassword&&error?.status===422)) return 'La contraseña ha sido rechazada. Utiliza una contraseña diferente que cumpla la política de seguridad.';
  return 'No se pudo completar la operación. Comprueba tu conexión y vuelve a intentarlo.';
}
async function start(){
  const {url,key}=clientConfig();
  if(!url||!key){view('setup');return;}
  try {
    authSubscription?.unsubscribe();
    store.client=window.supabase.createClient(url,key);$('connection-state').textContent='Conectado';
    authSubscription=store.client.auth.onAuthStateChange((event,session)=>{
      const newId=session?.user?.id||null;
      const changed=newId!==(store.user?.id||null);
      store.user=session?.user||null;
      if(changed)store.household=null;
      if(event==='PASSWORD_RECOVERY'){
        recovery.active=true;recovery.valid=!!session;
        recoveryMessage(session?'Introduce y confirma tu nueva contraseña.':'El enlace no es válido. Solicita otro correo.');
        showRecovery();return;
      }
      if(recovery.active){
        if(event==='SIGNED_OUT')invalidRecovery();
        return;
      }
      if(changed)setTimeout(()=>route().catch(fail),0);
    }).data.subscription;
    const {data:{session},error}=await store.client.auth.getSession();
    if(error)throw error;
    store.user=session?.user||null;
    if(linkError || (recovery.active&&!recovery.valid)){invalidRecovery();return;}
    await route();
  }catch(e){
    if(recovery.active){recoveryMessage(passwordError(e));showRecovery();}
    else {fail(e);view('setup');}
  }
}
async function route(){if(recovery.active){showRecovery();return;}if(!store.user){view('auth');return;}
  const {data,error}=await store.client.from('household_members').select('household_id').eq('user_id',store.user.id).maybeSingle();if(error)throw error;
  if(recovery.active){showRecovery();return;}
  if(!data){view('home-setup');return;}
  const r=await store.client.from('households').select('id,name,monthly_budget,invite_code').eq('id',data.household_id).single();if(r.error)throw r.error;
  if(recovery.active){showRecovery();return;}
  store.household=r.data;view('dashboard');$('home-display').textContent=r.data.name;$('invite-code').textContent=r.data.invite_code;$('user-email').textContent=`Sesión: ${store.user.email}`;await refresh();
}
async function refresh(){if(!store.household)return;
  const y=store.month.getFullYear(),m=store.month.getMonth();const from=monthKey(store.month)+'-01';const next=new Date(y,m+1,1);const to=monthKey(next)+'-01';
  const r=await store.client.from('purchases').select('id,store,purchased_on,total,created_at').eq('household_id',store.household.id).gte('purchased_on',from).lt('purchased_on',to).order('purchased_on',{ascending:false}).order('created_at',{ascending:false});if(r.error)throw r.error;
  store.purchases=r.data||[];
  const ids=store.purchases.map(x=>x.id);store.items=[];
  if(ids.length){const ir=await store.client.from('purchase_items').select('id,purchase_id,name,quantity,line_total').in('purchase_id',ids);if(ir.error)throw ir.error;store.items=ir.data||[];}
  render();
}
function render(){
  const spent=store.purchases.reduce((n,p)=>n+Number(p.total),0),budget=Number(store.household.monthly_budget),remaining=budget-spent;
  $('period-heading').textContent=store.month.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
  $('month-name').textContent=store.month.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
  $('remaining').textContent=fmt(remaining);$('spent').textContent=fmt(spent);$('budget').textContent=fmt(budget);
  $('progress-bar').style.width=`${budget>0?Math.min(100,(spent/budget)*100):spent>0?100:0}%`;
  $('progress-bar').style.background=remaining<0?'#ff9a8d':'#b7f2af';$('budget-warning').classList.toggle('hidden',remaining>=0);
  $('purchase-count').textContent=`${store.purchases.length} compras`;
  $('purchases-list').innerHTML=store.purchases.length?store.purchases.map(p=>`<button class="purchase-card" data-purchase="${p.id}"><span class="purchase-icon">🛒</span><span class="purchase-text"><b>${safe(p.store)}</b><small>${new Date(p.purchased_on+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</small></span><span class="purchase-price">${fmt(p.total)}</span></button>`).join(''):'<div class="empty">Todavía no hay compras registradas este mes.</div>';
  const byStore=new Map();store.purchases.forEach(p=>byStore.set(p.store.trim(),(byStore.get(p.store.trim())||0)+Number(p.total)));
  const byProduct=new Map();store.items.forEach(i=>{const name=i.name.trim().toLocaleLowerCase('es');byProduct.set(name,(byProduct.get(name)||0)+Number(i.line_total));});
  report('store-report',byStore,'Aún no hay gastos por supermercado.');report('product-report',byProduct,'Añade productos al registrar compras para ver este análisis.');
}
function report(id,map,empty){const list=[...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8),max=list[0]?.[1]||1;
  $(id).innerHTML=list.length?list.map(([name,value])=>`<div><div class="report-line"><span>${safe(name)}</span><b>${fmt(value)}</b></div><div class="report-meter"><div style="width:${Math.max(2,value/max*100)}%"></div></div></div>`).join(''):`<p class="muted">${empty}</p>`;
}
function addItem(name='',qty='1',total=''){const row=document.createElement('div');row.className='item-row';row.innerHTML=`<input class="item-name" aria-label="Producto" maxlength="120" required placeholder="Producto" value="${safe(name)}"><input class="item-qty" aria-label="Cantidad" type="number" min="0.01" step="0.01" required value="${safe(qty)}"><input class="item-total" aria-label="Subtotal del producto" type="number" min="0" step="0.01" required placeholder="€ total" value="${safe(total)}"><button type="button" class="remove-item" aria-label="Quitar producto">×</button>`;row.querySelector('button').onclick=()=>row.remove();$('items-container').appendChild(row);}
function dialog(id){$(id).showModal();}
async function savePurchase(ev){ev.preventDefault();const btn=$('save-purchase');btn.disabled=true;
  try{const total=Number($('purchase-total').value),storeName=$('purchase-store').value.trim(),date=$('purchase-date').value;
    if(!storeName||!date||!Number.isFinite(total)||total<=0)throw Error('Completa supermercado, fecha e importe positivo.');
    const items=[...document.querySelectorAll('#items-container .item-row')].map(row=>({name:row.querySelector('.item-name').value.trim(),quantity:Number(row.querySelector('.item-qty').value),line_total:Number(row.querySelector('.item-total').value)}));
    if(items.some(i=>!i.name||i.name.length>120||!Number.isFinite(i.quantity)||i.quantity<=0||!Number.isFinite(i.line_total)||i.line_total<0))throw Error('Revisa los productos y sus precios.');
    if(items.length && Math.round(items.reduce((n,i)=>n+i.line_total,0)*100)!==Math.round(total*100))throw Error('La suma de productos debe coincidir con el total del recibo.');
    const r=await store.client.from('purchases').insert({household_id:store.household.id,created_by:store.user.id,store:storeName,purchased_on:date,total}).select('id').single();if(r.error)throw r.error;
    if(items.length){const ir=await store.client.from('purchase_items').insert(items.map(i=>({...i,purchase_id:r.data.id})));if(ir.error){await store.client.from('purchases').delete().eq('id',r.data.id);throw Error('No se pudieron guardar los productos. Revisa y repite la compra.');}}
    $('purchase-dialog').close();$('purchase-form').reset();$('items-container').innerHTML='';store.month=new Date(Number(date.slice(0,4)),Number(date.slice(5,7))-1,1);await refresh();notice('Compra guardada ✔');
  }catch(e){fail(e);}finally{btn.disabled=false;}
}
function purchaseDetail(id){const p=store.purchases.find(x=>x.id===id);if(!p)return;store.selected=p;
  $('detail-title').textContent=p.store;$('detail-subtitle').textContent=new Date(p.purchased_on+'T12:00:00').toLocaleDateString('es-ES',{dateStyle:'long'});$('detail-total').textContent=fmt(p.total);
  const its=store.items.filter(i=>i.purchase_id===id);$('detail-items').innerHTML=its.length?its.map(i=>`<div class="detail-item"><span>${safe(i.name)} <span class="muted">×${safe(i.quantity)}</span></span><b>${fmt(i.line_total)}</b></div>`).join(''):'<p class="muted">Esta compra no tiene productos detallados.</p>';dialog('detail-dialog');
}
$('setup-form').onsubmit=e=>{e.preventDefault();const url=$('supabase-url').value.trim(),key=$('supabase-key').value.trim();if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)){notice('Utiliza la URL https://xxxxx.supabase.co');return;}localStorage.setItem('casa_url',url.replace(/\/$/,''));localStorage.setItem('casa_key',key);start().catch(fail);};
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
  if(!recovery.valid){invalidRecovery();return;}
  const password=$('new-password').value;
  if(password!==$('confirm-password').value){recoveryMessage('Las contraseñas no coinciden.');return;}
  const button=$('save-password');button.disabled=true;
  recoveryMessage('Guardando contraseña…');
  try{
    const {data:{session},error:sessionError}=await store.client.auth.getSession();
    if(sessionError)throw sessionError;
    if(!session){invalidRecovery();return;}
    const {error}=await store.client.auth.updateUser({password});
    if(error)throw error;
    $('recovery-form').reset();recovery.active=false;recovery.valid=false;
    history.replaceState(null,'',location.pathname+location.search);
    notice('Contraseña actualizada ✔');
    await route();
  }catch(error){
    if(error?.status===401 || error?.status===403 || ['session_not_found','session_expired','refresh_token_not_found','refresh_token_already_used','otp_expired'].includes(error?.code))invalidRecovery();
    else recoveryMessage(passwordError(error,true));
  }finally{button.disabled=!recovery.valid;}
};
$('recovery-retry-btn').onclick=()=>{
  recovery.active=false;recovery.valid=false;
  $('recovery-form').reset();$('auth-password').value='';
  history.replaceState(null,'',location.pathname);
  $('auth-message').textContent='Introduce tu email y pulsa «Olvidé mi contraseña» para solicitar otro enlace.';
  view('auth');$('auth-email').focus();
};
$('auth-form').onsubmit=async e=>{e.preventDefault();try{const r=await store.client.auth.signInWithPassword({email:$('auth-email').value.trim(),password:$('auth-password').value});if(r.error)throw r.error;store.user=r.data.user;await route();}catch(e){fail(e);}};
$('signup-btn').onclick=async()=>{try{const r=await store.client.auth.signUp({email:$('auth-email').value.trim(),password:$('auth-password').value,options:{emailRedirectTo:'https://jozeless.github.io/casa-budget/'}});if(r.error)throw r.error;if(r.data.session){store.user=r.data.user;await route();}else notice('Cuenta creada. Confirma tu email antes de entrar.');}catch(e){fail(e);}};
$('create-home-form').onsubmit=async e=>{e.preventDefault();try{const r=await store.client.rpc('create_my_household',{p_name:$('home-name').value.trim(),p_budget:Number($('initial-budget').value)});if(r.error)throw r.error;await route();notice('Hogar creado ✔');}catch(e){fail(e);}};
$('join-home-form').onsubmit=async e=>{e.preventDefault();try{const r=await store.client.rpc('join_my_household',{p_invite_code:$('join-code').value.trim()});if(r.error)throw r.error;await route();notice('Ya compartís hogar ✔');}catch(e){fail(e);}};
$('logout-btn').onclick=async()=>{const r=await store.client.auth.signOut();if(r.error)fail(r.error);else{store.user=null;store.household=null;view('auth');}};
$('prev-month').onclick=()=>{store.month=new Date(store.month.getFullYear(),store.month.getMonth()-1,1);refresh().catch(fail);};
$('next-month').onclick=()=>{store.month=new Date(store.month.getFullYear(),store.month.getMonth()+1,1);refresh().catch(fail);};
$('new-purchase-btn').onclick=()=>{$('purchase-date').value=dateLocal();$('items-container').innerHTML='';dialog('purchase-dialog');};
$('new-budget-btn').onclick=()=>{$('budget-input').value=store.household.monthly_budget;dialog('budget-dialog');};
$('add-item-btn').onclick=()=>addItem();
$('purchase-form').onsubmit=savePurchase;
$('budget-form').onsubmit=async e=>{e.preventDefault();try{const amount=Number($('budget-input').value);if(!Number.isFinite(amount)||amount<0)throw Error('Presupuesto inválido');const r=await store.client.from('households').update({monthly_budget:amount}).eq('id',store.household.id).select('monthly_budget').single();if(r.error)throw r.error;store.household.monthly_budget=r.data.monthly_budget;$('budget-dialog').close();render();notice('Presupuesto actualizado');}catch(err){fail(err);}};
$('purchases-list').onclick=e=>{const card=e.target.closest('[data-purchase]');if(card)purchaseDetail(card.dataset.purchase);};
$('delete-purchase').onclick=async()=>{if(!store.selected||!confirm(`¿Eliminar la compra de ${store.selected.store}?`))return;try{const r=await store.client.from('purchases').delete().eq('id',store.selected.id);if(r.error)throw r.error;$('detail-dialog').close();await refresh();notice('Compra eliminada');}catch(e){fail(e);}};
$('copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText(store.household.invite_code);notice('Código copiado');}catch(e){notice('Selecciona el código y cópialo manualmente.');}};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('./sw.js').catch(console.warn);
start().catch(fail);
})();
