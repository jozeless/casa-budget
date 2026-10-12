/* Private receipts UI. No API secrets; authenticated Supabase operations only. */
window.CASA_RECEIPT_UI=function({getStore,notice,duplicateApproval,applySaved,reloadAfterWrite,refresh}){
 const $=id=>document.getElementById(id),core=window.CASA_RECEIPTS,fmt=n=>new Intl.NumberFormat('es-NL',{style:'currency',currency:'EUR'}).format(n);
 // Scripts are ordered in index.html; fail safely if a hosting/cache error prevented loading.
 if(!core||core.apiVersion!==2||typeof core.inspectFile!=='function'){
  const message='No se pudo cargar la lectura de recibos. Actualiza CASA con conexión a Internet y vuelve a intentarlo.';
  const unavailable=()=>{$('add-menu-dialog').close();$('receipt-status').textContent=message;$('receipt-dialog').showModal();};
  for(const id of ['receipt-confirm','receipt-file','receipt-camera','receipt-select','receipt-take-photo'])$(id).disabled=true;
  $('receipt-storage-refresh').onclick=()=>{$('receipt-storage-status').textContent=message;};$('receipt-storage-delete').disabled=true;
  $('new-receipt-btn').onclick=unavailable;$('receipt-cancel').onclick=()=>$('receipt-dialog').close();
  let generation=0,reloading=false;
  const fallback={reset(){generation++; $('receipt-dialog').close();$('receipt-status').textContent='';},async edit(purchase){if(getStore().adjustments.some(a=>a.purchase_id===purchase.id)){unavailable();return true;}return false;},async showOriginal(){unavailable();}};
  $('receipt-process').classList.remove('hidden');$('receipt-process').disabled=false;$('receipt-process').textContent='Volver a cargar módulo';
  $('receipt-process').onclick=async()=>{
   if(reloading)return;reloading=true;const current=generation;$('receipt-process').disabled=true;$('receipt-status').textContent='Cargando módulo de recibos…';
   const script=document.createElement('script'),url=new URL('supabase/functions/_shared/receipt-core.js',document.baseURI);
   url.searchParams.set('casa-module','v10');url.searchParams.set('attempt',String(Date.now()));script.src=url.href;
   let timer;
   try{
    await new Promise((resolve,reject)=>{script.onload=()=>resolve();script.onerror=()=>reject(Error('MODULE_LOAD_FAILED'));timer=setTimeout(()=>reject(Error('MODULE_LOAD_TIMEOUT')),15000);document.head.appendChild(script);});
    if(!window.CASA_RECEIPTS||window.CASA_RECEIPTS.apiVersion!==2||typeof window.CASA_RECEIPTS.inspectFile!=='function')throw Error('MODULE_VERSION_MISMATCH');
    if(generation!==current)return;
    Object.assign(fallback,window.CASA_RECEIPT_UI({getStore,notice,duplicateApproval,applySaved,reloadAfterWrite,refresh}));
    fallback.reset();$('receipt-process').textContent='Consultar estado / reintentar';$('new-receipt-btn').click();
   }catch(error){if(generation===current)$('receipt-status').textContent=error.message==='MODULE_LOAD_TIMEOUT'?'La carga del módulo tardó demasiado. Comprueba la conexión y reintenta.':error.message==='MODULE_VERSION_MISMATCH'?'Se cargó una versión antigua del módulo. Actualiza CASA y pulsa Volver a cargar módulo.':'No se pudo descargar el módulo. Comprueba la conexión y pulsa Volver a cargar módulo.';}
   finally{clearTimeout(timer);script.remove();reloading=false;if(generation===current)$('receipt-process').disabled=false;}
  };
  return fallback;
 }
 const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let draft=null,receipt=null,editing=null,busy=false,epoch=0,originalUrl=null;
 const key=()=>`casa_pending_receipt_${getStore().user?.id}_${getStore().household?.id}`;
 const uploadKey=()=>key()+'_upload';
 const rpc=async(name,args)=>{const r=await getStore().client.rpc(name,args);if(r.error)throw r.error;return r.data;};
 const fail=error=>{const code=error?.code||error?.message;return ['PGRST202','PGRST205','42P01'].includes(code)?'Falta configurar CASA 3.0 en Supabase. Las compras manuales siguen disponibles.':error?.message||'No se pudo completar la operación.';};
 const functionErrors={PROCESSING:'Extracción en curso o respuesta pendiente. Consulta el estado; no vuelvas a enviarla.',DAILY_LIMIT:'Límite diario alcanzado.',AUTH_REQUIRED:'Vuelve a iniciar sesión.',TIMEOUT:'La extracción tardó demasiado. Consulta el estado antes de repetir.',SERVER_NOT_CONFIGURED:'La extracción todavía no está configurada.',PDF_UNSUPPORTED:'Usa un PDF de una página, sin cifrado ni contenido activo.',OPENAI_LIMIT:'El servicio de lectura ha alcanzado su límite.',OPENAI_ERROR:'Error del servicio de lectura. Puedes reintentar; puede consumir otra solicitud.',PROCESSING_ERROR:'No se pudo confirmar el resultado. Consulta el estado antes de repetir.',INVALID_EXTRACTION:'El resultado no es válido. Requiere revisión administrativa antes de repetir.',INCOMPLETE_EXTRACTION:'Lectura incompleta. Requiere revisión administrativa antes de repetir.',UPLOAD_MISSING:'El archivo no está subido. Selecciónalo de nuevo.',FILE_MISMATCH:'El archivo no coincide con el registro.'};
 function release(){if(originalUrl?.startsWith('blob:'))URL.revokeObjectURL(originalUrl);originalUrl=null;$('receipt-original').removeAttribute('href');$('receipt-preview').removeAttribute('src');$('receipt-preview').classList.add('hidden');}
 function reset(){epoch++;draft=null;receipt=null;editing=null;busy=false;release();$('receipt-form').reset();$('receipt-original').classList.add('hidden');$('receipt-file').value='';$('receipt-camera').value='';$('receipt-status').textContent='';for(const id of ['receipt-meta','receipt-uncertain','receipt-calculated','receipt-difference','receipt-validation','receipt-amount-status','receipt-advanced-alert','receipt-summary-store','receipt-summary-date','receipt-summary-count','receipt-summary-total','receipt-summary-discount'])$(id).textContent='';$('receipt-delete-before').value='';$('receipt-items').innerHTML='';$('receipt-adjustments').innerHTML='';$('receipt-review').classList.add('hidden');$('receipt-dialog').close();$('receipt-library').innerHTML='';$('receipt-pending').innerHTML='';$('receipt-storage-status').textContent='';$('receipt-year').innerHTML='<option value="">Todos los años</option>';$('receipt-advanced').open=false;buttons();}
 function guard(message='¿Abandonar la revisión sin guardar? El recibo pendiente se podrá recuperar.'){if(busy){notice('Espera a que termine la operación.');return false;}if(draft&&!confirm(message))return false;return true;}
 async function metadata(){const s=getStore(),user=s.user?.id,home=s.household?.id,generation=epoch;let rows=[];
 for(let from=0;;from+=200){const r=await s.client.from('purchase_receipts').select('id,purchase_id,path,status,mime,bytes,created_at,error_code').eq('household_id',home).order('created_at',{ascending:false}).order('id').range(from,from+199);if(r.error)throw r.error;if(generation!==epoch||getStore().user?.id!==user||getStore().household?.id!==home)throw Error('La sesión cambió.');rows.push(...r.data);if(r.data.length<200)return rows;}}

 function productOptions(value){const items=[...$('receipt-items').children].map(row=>row.querySelector('.r-name').value);return '<option value="">General (sin atribuir)</option>'+items.map((name,index)=>`<option value="${index}" ${Number(value)===index&&value!==''?'selected':''}>${index+1}. ${safe(name||'Producto pendiente')}</option>`).join('')+(value!==''&&Number(value)>=items.length?`<option value="${safe(value)}" selected>Revisar producto vinculado</option>`:'');}
 function advancedTarget(value){
  if(!value.store||value.store.length>80)return $('receipt-store');
  if(!core.date(value.date))return $('receipt-date');
  if(!core.money(value.total)||value.total<=0||value.total>9999999999.99)return $('receipt-total');
  for(let index=0;index<value.adjustments.length;index++){
   const a=value.adjustments[index],row=$('receipt-adjustments').children[index];
   if(a.effect==='uncertain')return row.querySelector('.r-effect');
   if(a.effect!=='applies_to_total')continue;
   if(!core.kinds.includes(a.kind))return row.querySelector('.r-kind');
   if(!a.description||a.description.length>160)return row.querySelector('.r-description');
   if(!Number.isSafeInteger(a.amount_cents)||Math.abs(a.amount_cents)>999999999999)return row.querySelector('.r-amount');
   if(a.item_index!==null&&(!Number.isInteger(a.item_index)||a.item_index<0||a.item_index>=value.items.length))return row.querySelector('.r-index');
  }
  return null;
 }
 function presentation(value,result){
  $('receipt-summary-store').textContent=value.store||'Supermercado pendiente';
  if(core.date(value.date)){const [year,month,day]=value.date.split('-').map(Number);$('receipt-summary-date').textContent=new Date(year,month-1,day).toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'});}else $('receipt-summary-date').textContent='Fecha pendiente de revisión';
  $('receipt-summary-count').textContent=value.items.length+(value.items.length===1?' producto':' productos');
  $('receipt-summary-total').textContent=core.money(value.total)?fmt(value.total):'Total pendiente';
  const discount=value.adjustments.filter(a=>a.effect==='applies_to_total'&&a.kind==='discount'&&Number.isSafeInteger(a.amount_cents)).reduce((sum,a)=>sum+a.amount_cents,0);
  $('receipt-summary-discount').classList.toggle('hidden',discount===0);$('receipt-summary-discount').textContent=discount?'Descuento aplicado: '+fmt(discount/100):'';
  const matched=result.complete&&result.difference===0;
  $('receipt-amount-status').textContent=matched?'Importes correctos · Diferencia '+fmt(0):result.difference===null?'Importes pendientes de revisión':'Los importes no cuadran · Diferencia '+fmt(result.difference/100);
  $('receipt-amount-status').classList.toggle('receipt-balance-ok',matched);$('receipt-amount-status').classList.toggle('receipt-balance-error',!matched);
  const advancedIssue=advancedTarget(value)||(!matched&&result.difference!==null);
  $('receipt-advanced-alert').classList.toggle('hidden',!advancedIssue);$('receipt-advanced-link').classList.toggle('hidden',!advancedIssue);
  $('receipt-advanced-alert').textContent=advancedIssue?'Hay importes o campos pendientes en Opciones avanzadas. Revisa también las líneas de productos.':'';
  for(const row of $('receipt-adjustments').children){const effect=row.querySelector('.r-effect'),description=row.querySelector('.r-description').value,amount=row.querySelector('.r-amount').value;
   row.querySelector('.r-adjustment-name').textContent=description||'Ajuste pendiente';row.querySelector('.r-adjustment-value').textContent=amount!==''&&core.money(Number(amount))?fmt(Number(amount)):'Importe pendiente';row.querySelector('.r-adjustment-effect').textContent=effect.selectedOptions[0].textContent;
  }
 }
 function buttons(){
 for(const row of $('receipt-items').children){
  const name=row.querySelector('.r-name').value,qty=row.querySelector('.r-qty').value,amount=row.querySelector('.r-total').value;
  const invalid=!name.trim()||name.trim().length>120||qty===''||!core.money(Number(qty))||Number(qty)<=0||Number(qty)>9999999.99||amount===''||!core.money(Number(amount))||Number(amount)<0||Number(amount)>9999999999.99;
  const needs=invalid||((row.dataset.proposed==='true'||row.dataset.review==='true')&&!$('receipt-reviewed').checked);
  row.querySelector('.r-summary-name').textContent=name||'Producto pendiente';row.querySelector('.r-summary-values').textContent=`× ${qty||'?'} · ${amount!==''&&core.money(Number(amount))?fmt(Number(amount)):'Subtotal pendiente'}`;
  row.querySelector('.r-review-mark').classList.toggle('hidden',!needs);row.classList.toggle('needs-review',needs);
 }
 for(const row of $('receipt-adjustments').children){const counted=row.querySelector('.r-effect').value==='applies_to_total';row.querySelector('.r-amount').required=counted;row.querySelector('.r-description').required=counted;}
 for(const select of document.querySelectorAll('#receipt-adjustments .r-index')){const value=select.value;select.innerHTML=productOptions(value);select.value=value;}for(const input of document.querySelectorAll('#receipt-review input,#receipt-review select,#receipt-review button[type=button]'))input.disabled=busy;const result=draft?core.reconcile(read()):null;$('receipt-confirm').disabled=busy||!result?.valid||!$('receipt-reviewed').checked;$('receipt-process').disabled=busy||!!editing;$('receipt-file').disabled=busy;$('receipt-camera').disabled=busy;$('receipt-cancel').disabled=busy;
 $('receipt-reviewed').disabled=busy;$('receipt-select').disabled=busy;$('receipt-take-photo').disabled=busy;
 $('receipt-upload').classList.toggle('hidden',!!draft||busy);$('receipt-review-check').classList.toggle('hidden',!draft);$('receipt-confirm').classList.toggle('hidden',!draft);
 $('receipt-title').textContent=draft?'Revisar recibo':'Añadir recibo';
 const process=$('receipt-process'),host=draft?$('receipt-advanced-tools'):$('receipt-upload-recovery');if(process.parentElement!==host)host.appendChild(process);process.classList.toggle('hidden',!draft&&!receipt&&!$('receipt-file').files.length&&!$('receipt-camera').files.length);
 if(result){presentation(read(),result);$('receipt-calculated').textContent=(result.complete?'':'Parcial: ')+fmt(result.calculated/100);$('receipt-difference').textContent=result.difference===null?'Pendiente':fmt(result.difference/100);$('receipt-validation').textContent=result.errors.filter(error=>!error.startsWith('Confirma que has revisado')&&error!=='Productos y ajustes no coinciden con el total pagado.').join(' ');}}
 function read(){return {...draft,store:$('receipt-store').value.trim(),date:$('receipt-date').value,total:$('receipt-total').value===''?null:Number($('receipt-total').value),reviewed:$('receipt-reviewed').checked,
 items:[...$('receipt-items').children].map(row=>({name:row.querySelector('.r-name').value.trim(),quantity:row.querySelector('.r-qty').value===''?null:Number(row.querySelector('.r-qty').value),line_total:row.querySelector('.r-total').value===''?null:Number(row.querySelector('.r-total').value)})),
 adjustments:[...$('receipt-adjustments').children].map(row=>({effect:row.querySelector('.r-effect').value,kind:row.querySelector('.r-kind').value,description:row.querySelector('.r-description').value.trim(),amount_cents:row.querySelector('.r-amount').value===''?null:core.money(Number(row.querySelector('.r-amount').value))?core.cents(Number(row.querySelector('.r-amount').value)):NaN,item_index:row.querySelector('.r-index').value===''?null:Number(row.querySelector('.r-index').value)}))};}
 function itemRow(item={name:'',quantity:null,line_total:null}){
 const row=document.createElement('details');row.className='receipt-item receipt-product';row.dataset.proposed=String(!!item.proposed);row.dataset.review=String(!!item.needs_review);row.innerHTML=`<summary><span class="r-summary-name"></span><span class="r-summary-values"></span><span class="r-review-mark hidden">Revisar</span></summary><div class="receipt-product-editor stack"><label>Producto<input class="r-name" maxlength="120" required value="${safe(item.name)}"></label><div class="receipt-pair"><label>Cantidad<input class="r-qty" type="number" min="0.01" step="0.01" required value="${safe(item.quantity)}"></label><label>Subtotal (€)<input class="r-total" type="number" min="0" step="0.01" required value="${safe(item.line_total)}"></label></div><p class="hint">${safe([item.unit,item.unit_price===null||item.unit_price===undefined?'':fmt(item.unit_price)+' / unidad',item.source].filter(Boolean).join(' · '))}</p><button type="button" class="text-button">Quitar producto</button></div>`;
 row.querySelector('button').onclick=()=>{if(!confirm('¿Quitar producto? Los ajustes vinculados quedarán sin atribuir; revísalos.'))return;const index=[...$('receipt-items').children].indexOf(row);for(const adjustment of $('receipt-adjustments').children){const input=adjustment.querySelector('.r-index');if(input.value!==''&&Number(input.value)>=index)input.value=Number(input.value)===index?'':Number(input.value)-1;}row.remove();buttons();};$('receipt-items').appendChild(row);
 }
 function adjustmentRow(a={effect:'applies_to_total',kind:'discount',description:'',amount_cents:null,item_index:null}){
 const row=document.createElement('details');row.className='receipt-item receipt-adjustment';row.innerHTML=`<summary><span class="r-adjustment-name"></span><span class="r-adjustment-value"></span><span class="r-adjustment-effect"></span></summary><div class="stack receipt-adjustment-editor"><label>Interpretación<select class="r-effect">${[['applies_to_total','Afecta al total'],['informational','Informativo: no sumar'],['already_included','Ya incluido: no sumar'],['uncertain','Pendiente de revisión']].map(([value,label])=>`<option value="${value}" ${value===(a.effect||'applies_to_total')?'selected':''}>${label}</option>`).join('')}</select></label><label>Tipo<select class="r-kind">${core.kinds.map(k=>`<option value="${k}" ${k===a.kind?'selected':''}>${({discount:'Descuento',deposit:'Depósito',return:'Devolución de envases',rounding:'Redondeo',other:'Otro'})[k]}</option>`).join('')}</select></label><label>Descripción<input class="r-description" required maxlength="160" value="${safe(a.description)}"></label><div class="receipt-pair"><label>Importe firmado (€)<input class="r-amount" type="number" step="0.01" required value="${safe(a.amount_cents===null?'':a.amount_cents/100)}"></label><label>Asignar a producto<select class="r-index">${productOptions(a.item_index===null?'':String(a.item_index))}</select></label></div><p class="hint">${safe(a.source||'No repartir descuentos generales entre productos.')}</p><button type="button" class="text-button">Quitar ajuste</button></div>`;row.querySelector('button').onclick=()=>{row.remove();buttons();};$('receipt-adjustments').appendChild(row);
 }
 function display(value){draft=value;$('receipt-meta').textContent=[draft.establishment,draft.time?'Hora: '+draft.time:''].filter(Boolean).join(' · ');$('receipt-review').classList.remove('hidden');$('receipt-store').value=draft.store;$('receipt-date').value=draft.date;$('receipt-total').value=draft.total??'';$('receipt-reviewed').checked=!!draft.reviewed;$('receipt-uncertain').textContent=[...(draft.uncertain||[]),...(draft.warnings||[])].join(' · ');$('receipt-items').innerHTML='';$('receipt-adjustments').innerHTML='';draft.items.forEach(itemRow);draft.adjustments.forEach(adjustmentRow);$('receipt-advanced').open=!!advancedTarget(read())||core.reconcile(read()).difference!==0;buttons();}
 async function original(row){const generation=epoch;release();if(!row?.path){notice('Este recibo ya no conserva su archivo.');return;}const r=await getStore().client.storage.from('receipts').createSignedUrl(row.path,120);if(r.error)throw r.error;if(generation!==epoch)return;originalUrl=r.data.signedUrl;$('receipt-original').href=originalUrl;$('receipt-original').classList.remove('hidden');if(row.mime?.startsWith('image/')){$('receipt-preview').src=originalUrl;$('receipt-preview').classList.remove('hidden');}}
 async function open(){if(localStorage.getItem(`casa_pending_purchase_${getStore().user?.id}_${getStore().household?.id}`)){notice('Hay una compra manual pendiente. Reinténtala antes de subir un recibo.');return;}if(!guard())return;draft=null;receipt=null;editing=null;release();$('receipt-file').value='';$('receipt-camera').value='';$('receipt-original').classList.add('hidden');$('receipt-review').classList.add('hidden');$('receipt-status').textContent='Selecciona un recibo para analizarlo con OpenAI. No se guardará ninguna compra sin tu confirmación.';$('receipt-dialog').showModal();buttons();try{const pending=JSON.parse(localStorage.getItem(uploadKey())||'null');if(pending){receipt=pending;$('receipt-status').textContent='Hay un recibo pendiente. Pulsa Consultar estado / reintentar para consultar su resultado; selecciona el mismo archivo si la subida no terminó.';}const pendingSave=JSON.parse(localStorage.getItem(key())||'null');if(pendingSave){editing=getStore().purchases.find(p=>p.id===pendingSave.p_purchase_id)||null;receipt=pendingSave.p_receipt_id?{id:pendingSave.p_receipt_id,path:getStore().household.id+'/'+pendingSave.p_receipt_id+'/original'}:null;display({store:pendingSave.p_store,date:pendingSave.p_date,total:pendingSave.p_total,items:pendingSave.p_items,adjustments:pendingSave.p_adjustments,uncertain:[],warnings:['Guardado pendiente: reintenta sin modificar datos.'],reviewed:true});}buttons();await library(true);}catch(error){$('receipt-status').textContent=fail(error);}}
 async function process(){if(busy)return;if(draft&&!confirm('¿Descartar los cambios de revisión y recuperar la extracción original?'))return;busy=true;buttons();$('receipt-status').textContent='Preparando recibo…';const generation=epoch,s=getStore(),user=s.user?.id,home=s.household?.id;
 try{
  let file=$('receipt-camera').files[0]||$('receipt-file').files[0];
  if(file){
   if(file.size>10485760)throw Error('El archivo supera 10 MB.');const bytes=new Uint8Array(await file.arrayBuffer()),info=core.inspectFile(bytes);
   if(info.mime!=='application/pdf'){
    const bitmap=await createImageBitmap(file);
    try{
     if(bitmap.width*bitmap.height>12000000)throw Error('La imagen supera 12 megapíxeles.');
     // Lossless displayed pixels only: no resize, JPEG recompression or PDF rasterization.
     if(info.mime==='image/png'){
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      canvas.getContext('2d').drawImage(bitmap,0,0);
      const optimized=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(optimized&&optimized.size<file.size*0.8)file=optimized;
      canvas.width=0;canvas.height=0;
     }
    }finally{bitmap.close();}
   }
   if(!receipt){receipt=await rpc('casa_receipt_begin',{p_id:crypto.randomUUID(),p_household_id:home,p_mime:info.mime,p_bytes:file.size});localStorage.setItem(uploadKey(),JSON.stringify({id:receipt.id,path:receipt.path,mime:receipt.mime,bytes:receipt.bytes}));}
   if(receipt.mime!==info.mime||receipt.bytes!==file.size)throw Error('Hay una subida pendiente. Cancélala antes de seleccionar otro archivo.');
   localStorage.setItem(uploadKey(),JSON.stringify({id:receipt.id,path:receipt.path,mime:receipt.mime,bytes:receipt.bytes}));$('receipt-status').textContent='Subiendo recibo privado…';const upload=await s.client.storage.from('receipts').upload(receipt.path,file,{contentType:info.mime,upsert:false});
   if(upload.error&&!['409','Duplicate','ResourceAlreadyExists'].includes(String(upload.error.statusCode||upload.error.error)))throw upload.error;
  }
  if(!receipt)throw Error('Selecciona un recibo.');$('receipt-status').textContent='Analizando recibo… No cierres esta pantalla.';
  const r=await s.client.functions.invoke('extract-receipt',{body:{receiptId:receipt.id}});
  if(r.error){let body;try{body=await r.error.context.json();}catch{}throw Error(functionErrors[body?.error]||'No se pudo analizar el recibo. Consulta el estado antes de repetir.');}
  if(r.data?.error)throw Error(functionErrors[r.data.error]||'Error de lectura.');
  if(generation!==epoch||getStore().user?.id!==user||getStore().household?.id!==home)return;
  display(core.draftFromExtraction(r.data.result));await original(receipt);$('receipt-status').textContent=r.data.cached?'Resultado recuperado. Revisa antes de guardar.':'Lectura terminada. Revisa antes de guardar.';
 }catch(error){if(generation===epoch)$('receipt-status').textContent=fail(error);}finally{if(generation===epoch){busy=false;buttons();}}
 }
 async function save(event){event.preventDefault();if(busy)return;const value=read(),check=core.reconcile(value);if(!check.valid){buttons();return;}busy=true;buttons();const s=getStore(),user=s.user.id,home=s.household.id,generation=epoch,storageKey=key();let op;
 try{
  const params={p_household_id:home,p_purchase_id:editing?.id||null,p_expected_revision:editing?.revision??null,p_store:value.store,p_date:value.date,p_total:value.total,p_items:value.items,p_adjustments:value.adjustments.filter(a=>a.effect==='applies_to_total').map(({effect,...adjustment})=>adjustment),p_receipt_id:receipt?.id||null};
  op=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(op){const {p_operation_id,...previous}=op;if(JSON.stringify({...params,p_expected_revision:previous.p_expected_revision})!==JSON.stringify(previous))throw Error('Hay un guardado pendiente. Reintenta con los datos originales.');}
  else{
   if(!editing){let from=0,candidates=[];while(true){const r=await s.client.from('purchases').select('id,store').eq('household_id',home).eq('purchased_on',value.date).eq('total',value.total).order('id').range(from,from+199);if(r.error)throw r.error;candidates.push(...r.data);if(r.data.length<200)break;from+=200;}
    if(candidates.some(p=>window.CASA_BUDGET.productKey(p.store)===window.CASA_BUDGET.productKey(value.store))&&!await duplicateApproval())return;}
   op={...params,p_operation_id:crypto.randomUUID()};localStorage.setItem(storageKey,JSON.stringify(op));
  }
  const result=await s.client.rpc('casa_save_receipt',op);
  if(result.error){if(result.error.code==='40001')await refresh(true).catch(()=>{});if(['42501','40001','P0001','PGRST202'].includes(result.error.code)||/^(22|23)/.test(result.error.code||''))localStorage.removeItem(storageKey);throw result.error;}
  localStorage.removeItem(storageKey);localStorage.removeItem(uploadKey());
  if(generation!==epoch||getStore().user?.id!==user||getStore().household?.id!==home)return;
  applySaved(result.data);draft=null;$('receipt-dialog').close();release();await reloadAfterWrite(editing?'Compra actualizada ✔':'Compra guardada ✔');
 }catch(error){if(generation===epoch)$('receipt-status').textContent=fail(error)+(localStorage.getItem(storageKey)?' Guardado pendiente: no registres otra compra. Reintenta con los mismos datos.':'');}
 finally{if(generation===epoch){busy=false;buttons();}}
 }
 async function edit(purchase){if(busy)return;const s=getStore();if(localStorage.getItem(key()))throw Error('Hay un guardado pendiente. Abre Subir recibo para reintentarlo.');release();$('receipt-original').classList.add('hidden');const adjustments=s.adjustments.filter(a=>a.purchase_id===purchase.id);if(!adjustments.length&&!s.receipts.some(r=>r.purchase_id===purchase.id))return false;editing=purchase;receipt=null;const items=s.items.filter(i=>i.purchase_id===purchase.id);const rows=await metadata();const row=rows.find(r=>r.purchase_id===purchase.id);receipt=row?.path?row:null;
 const value={store:purchase.store,date:purchase.purchased_on,total:Number(purchase.total),items:items.map(i=>({...i,quantity:Number(i.quantity),line_total:Number(i.line_total)})),adjustments:adjustments.map(a=>({...a,amount_cents:Number(a.amount_cents),item_index:a.item_id?items.findIndex(i=>i.id===a.item_id):null})),uncertain:[],warnings:[],reviewed:true};
 $('detail-dialog').close();$('receipt-dialog').showModal();display(value);$('receipt-status').textContent='Editar compra y ajustes contables.';if(receipt)await original(receipt);return true;
 }
 async function resume(id){if(busy||!guard())return;const generation=epoch;const r=await getStore().client.from('purchase_receipts').select('*').eq('id',id).single();if(r.error)throw r.error;if(generation!==epoch)return;if(r.data.purchase_id)throw Error('Esta compra ya está guardada. Ábrela desde Historial.');receipt=r.data;editing=null;if(r.data.result){display(core.draftFromExtraction(r.data.result));await original(receipt);}else{draft=null;$('receipt-review').classList.add('hidden');buttons();}$('receipt-dialog').showModal();$('receipt-status').textContent='Recibo pendiente recuperado.';}
 async function remove(row){const s=getStore();if(row.path){const r=await s.client.storage.from('receipts').remove([row.path]);if(r.error)throw r.error;}await rpc('casa_receipt_forget_file',{p_id:row.id});getStore().receipts=getStore().receipts.map(r=>r.id===row.id?{...r,path:null}:r);}
 async function library(pendingOnly=false){const selected=new Set([...document.querySelectorAll('#receipt-library input:checked')].map(n=>n.value));const rows=await metadata();const active=rows.filter(r=>r.path);if(pendingOnly){$('receipt-pending').innerHTML=active.filter(r=>!r.purchase_id&&r.status!=='cancelled').map(r=>`<button type="button" class="text-button" data-resume="${safe(r.id)}">Recuperar ${safe(r.created_at.slice(0,10))} · ${safe(r.status)}</button>`).join('');return;}
 $('receipt-storage-status').textContent=`${active.length} recibos · ${(active.reduce((n,r)=>n+Number(r.bytes),0)/1048576).toFixed(1)} MB aproximados. No se borran automáticamente.`;
 const previous=$('receipt-year').value,years=[...new Set(active.map(r=>r.created_at.slice(0,4)))];$('receipt-year').innerHTML='<option value="">Todos los años</option>'+years.map(y=>`<option>${safe(y)}</option>`).join('');$('receipt-year').value=years.includes(previous)?previous:'';
 const year=$('receipt-year').value;$('receipt-library').innerHTML=active.filter(r=>!year||r.created_at.startsWith(year)).map(r=>`<label class="receipt-library-row"><input type="checkbox" value="${safe(r.id)}" ${r.status==='processing'?'disabled':''} ${selected.has(r.id)?'checked':''}> ${safe(r.created_at.slice(0,10))} · ${(r.bytes/1048576).toFixed(2)} MB · ${safe(r.status)}</label>`).join('');return rows;}
 $('new-receipt-btn').onclick=()=>{$('add-menu-dialog').close();open().catch(e=>notice(fail(e)));};
 $('receipt-select').onclick=()=>{$('receipt-file').click();};$('receipt-take-photo').onclick=()=>{$('receipt-camera').click();};
 $('receipt-file').onchange=()=>{$('receipt-camera').value='';if($('receipt-file').files.length)return process();};$('receipt-camera').onchange=()=>{$('receipt-file').value='';if($('receipt-camera').files.length)return process();};$('receipt-process').onclick=process;$('receipt-form').onsubmit=save;
 $('receipt-advanced-link').onclick=()=>{$('receipt-advanced').open=true;const target=advancedTarget(read())||$('receipt-total');const inner=target.closest('details');if(inner)inner.open=true;target.focus();target.scrollIntoView({block:'center'});};
 $('receipt-form').addEventListener('invalid',event=>{const details=event.target.closest('details');if(details){details.open=true;if($('receipt-advanced').contains(event.target))$('receipt-advanced').open=true;}},true);
 const fitReceipt=()=>{if(window.visualViewport){$('receipt-dialog').style.setProperty('--receipt-viewport-height',window.visualViewport.height+'px');$('receipt-dialog').style.setProperty('--receipt-viewport-top',window.visualViewport.offsetTop+'px');}};fitReceipt();window.visualViewport?.addEventListener('resize',fitReceipt);window.visualViewport?.addEventListener('scroll',fitReceipt);
 $('receipt-form').oninput=buttons;$('receipt-add-item').onclick=()=>{itemRow();const row=$('receipt-items').lastElementChild;row.open=true;buttons();row.querySelector('.r-name').focus();};$('receipt-add-adjustment').onclick=()=>{adjustmentRow();const row=$('receipt-adjustments').lastElementChild;row.open=true;buttons();row.querySelector('.r-description').focus();};
 $('receipt-pending').onclick=e=>{const b=e.target.closest('[data-resume]');if(b)resume(b.dataset.resume).catch(error=>notice(fail(error)));};
 $('receipt-dialog').oncancel=e=>{e.preventDefault();if(guard())$('receipt-dialog').close();};
 $('receipt-cancel').onclick=async()=>{if(localStorage.getItem(key())){notice('Hay un guardado pendiente. Reintenta para confirmar su resultado antes de cancelar.');return;}if(!guard(editing?'¿Descartar los cambios de edición?':'¿Cancelar el recibo y eliminar su archivo pendiente? No se guardará ninguna compra.'))return;if(receipt&&!editing&&!draft&&!confirm('¿Cancelar y eliminar el archivo pendiente?'))return;try{if(receipt&&!editing){await rpc('casa_receipt_cancel',{p_id:receipt.id});localStorage.removeItem(uploadKey());await remove(receipt);}draft=null;reset();}catch(error){$('receipt-status').textContent=fail(error)+' El archivo pendiente se conserva; puedes revisar la limpieza en Settings.';}};
 window.addEventListener('beforeunload',event=>{if(draft||busy){event.preventDefault();event.returnValue='';}});
 $('receipt-storage-delete').disabled=false;
 $('receipt-storage-refresh').onclick=()=>library().catch(error=>{$('receipt-storage-status').textContent=fail(error);});$('receipt-year').onchange=$('receipt-storage-refresh').onclick;
 $('receipt-storage-delete').onclick=async()=>{const selected=[...document.querySelectorAll('#receipt-library input:checked')].map(n=>n.value),before=$('receipt-delete-before').value;if(!selected.length&&!before){notice('Selecciona imágenes o una fecha límite.');return;}if(!confirm('¿Borrar solo las imágenes seleccionadas o anteriores a la fecha indicada? Las compras, productos, ajustes y estadísticas se conservarán.'))return;const button=$('receipt-storage-delete');button.disabled=true;
 try{const rows=await metadata();let failed=0;for(const row of rows.filter(r=>r.path&&r.status!=='processing'&&(selected.includes(r.id)||(before&&r.created_at.slice(0,10)<before)))){try{await remove(row);}catch{failed++;}}await library();if(failed)throw Error(failed+' archivos no pudieron borrarse. Reintenta; las compras se conservan.');notice('Imágenes eliminadas. Compras y estadísticas conservadas.');}catch(error){$('receipt-storage-status').textContent=fail(error);}finally{button.disabled=false;}};
 return {reset,edit,async showOriginal(purchase){const generation=epoch;const rows=await metadata(),row=rows.find(r=>r.purchase_id===purchase.id&&r.path);if(!row){notice('Esta compra no tiene un archivo disponible.');return;}const r=await getStore().client.storage.from('receipts').createSignedUrl(row.path,120);if(r.error)throw r.error;if(generation!==epoch)return;window.open(r.data.signedUrl,'_blank','noopener,noreferrer');},buttons};
};
