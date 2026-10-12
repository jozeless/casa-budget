/* Shared, dependency-free accounting/validation. Loaded by the PWA and Edge Function. */
(function(root){
'use strict';
const kinds=['discount','deposit','return','rounding','other'];
const money=value=>Number.isFinite(value)&&Math.abs(value*100-Math.round(value*100))<0.00001;
const cents=value=>Math.round(value*100);
const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value;};
function reconcile(draft){
 const errors=[];const items=draft.items||[],adjustments=draft.adjustments||[];
 if(typeof draft.store!=='string'||!draft.store.trim()||draft.store.trim().length>80)errors.push('Revisa el supermercado.');
 if(!date(draft.date))errors.push('Revisa la fecha.');
 if(!money(draft.total)||draft.total<=0||draft.total>9999999999.99)errors.push('El total debe ser positivo, con dos decimales. Devoluciones completas no compatibles.');
 if(!Array.isArray(items)||items.length>500||!Array.isArray(adjustments)||adjustments.length>100)return {valid:false,errors:['Demasiadas líneas.'],calculated:0,difference:0};
 let sum=0;
 items.forEach(i=>{if(typeof i.name!=='string'||!i.name.trim()||i.name.trim().length>120||!money(i.quantity)||i.quantity<=0||i.quantity>9999999.99||!money(i.line_total)||i.line_total<0||i.line_total>9999999999.99)errors.push('Revisa los productos: nombre, cantidad positiva (máximo dos decimales) y subtotal no negativo.');else sum+=cents(i.line_total);});
 adjustments.forEach(a=>{if(!kinds.includes(a.kind)||typeof a.description!=='string'||!a.description.trim()||a.description.trim().length>160||!Number.isSafeInteger(a.amount_cents)||Math.abs(a.amount_cents)>999999999999||(a.item_index!==null&&(!Number.isInteger(a.item_index)||a.item_index<0||a.item_index>=items.length)))errors.push('Revisa los ajustes y su producto asociado.');else sum+=a.amount_cents;});
 const difference=cents(draft.total||0)-sum;
 if((items.length||adjustments.length)&&difference!==0)errors.push('Productos y ajustes no coinciden con el total pagado.');
 if(((draft.uncertain||[]).length||(draft.warnings||[]).length)&&!draft.reviewed)errors.push('Confirma que has revisado los campos inciertos.');
 return {valid:errors.length===0,errors:[...new Set(errors)],calculated:sum,difference};
}
const nullable=type=>({type:[type,'null']});
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const list=items=>({type:'array',items});
const extractionSchema=object({store:nullable('string'),establishment:nullable('string'),date:nullable('string'),time:nullable('string'),
 items:list(object({name:nullable('string'),quantity:nullable('number'),unit:nullable('string'),unit_price:nullable('number'),line_total:nullable('number'),source:nullable('string')})),
 adjustments:list(object({kind:{type:'string',enum:kinds},description:nullable('string'),amount_cents:nullable('integer'),item_index:nullable('integer'),source:nullable('string')})),
 total:nullable('number'),uncertain:list({type:'string'}),warnings:list({type:'string'})});
function validateExtraction(value,schema=extractionSchema){
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==schema.required.length||schema.required.some(k=>!Object.hasOwn(value,k)))throw Error('INVALID_EXTRACTION');
  for(const [key,sub]of Object.entries(schema.properties))validateExtraction(value[key],sub);
 }else if(schema.type==='array'){
  if(!Array.isArray(value)||value.length>500)throw Error('INVALID_EXTRACTION');value.forEach(v=>validateExtraction(v,schema.items));
 }else{
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  if(!(value===null?types.includes('null'):types.includes(typeof value)||(types.includes('integer')&&Number.isSafeInteger(value))))throw Error('INVALID_EXTRACTION');
  if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>999999999999))throw Error('INVALID_EXTRACTION');
  if(typeof value==='string'&&value.length>1000)throw Error('INVALID_EXTRACTION');
  if(schema.enum&&!schema.enum.includes(value))throw Error('INVALID_EXTRACTION');
 }
 return value;
}
function draftFromExtraction(value){
 validateExtraction(value);
 const uncertain=[...value.uncertain];
 if(!value.store)uncertain.push('Supermercado ausente');if(!date(value.date))uncertain.push('Fecha ausente o ilegible');if(value.total===null)uncertain.push('Total ausente');
 const sourceKeys=new Set();
 const items=value.items.map((i,index)=>{const sourceKey=i.source&&JSON.stringify([i.source,i.name,i.quantity,i.line_total]);if(sourceKey&&sourceKeys.has(sourceKey))uncertain.push('Posible línea repetida de extracción: producto '+(index+1)+'. Revisa el original; no se ha fusionado.');if(sourceKey)sourceKeys.add(sourceKey);if(i.name===null||i.quantity===null||i.line_total===null)uncertain.push('Producto '+(index+1)+': faltan datos');return {name:i.name||'',quantity:i.quantity,line_total:i.line_total,unit:i.unit,unit_price:i.unit_price,source:i.source};});
 const adjustments=value.adjustments.map((a,index)=>{if(a.description===null||a.amount_cents===null)uncertain.push('Ajuste '+(index+1)+': faltan datos');return {...a};});
 return {store:value.store||'',establishment:value.establishment,time:value.time,date:value.date||'',total:value.total,items,adjustments,uncertain:[...new Set(uncertain)],warnings:value.warnings,reviewed:false};
}
function inspectFile(bytes,maxBytes=10485760){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>maxBytes)throw Error('Archivo vacío o demasiado grande (máximo '+Math.floor(maxBytes/1048576)+' MB).');
 const b=bytes,ascii=(from,to)=>String.fromCharCode(...b.slice(from,to));let mime,width=0,height=0;
 if(b.length>=24&&b[0]===137&&ascii(1,4)==='PNG'&&b[4]===13&&b[5]===10&&b[6]===26&&b[7]===10&&ascii(12,16)==='IHDR'){
  mime='image/png';const v=new DataView(b.buffer,b.byteOffset,b.byteLength);width=v.getUint32(16);height=v.getUint32(20);
 }else if(b[0]===255&&b[1]===216){
  mime='image/jpeg';let p=2;while(p+9<b.length){if(b[p]!==255)break;const marker=b[p+1];if(marker===0xda||marker===0xd9)break;const length=(b[p+2]<<8)+b[p+3];if(length<2||p+length+2>b.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){height=(b[p+5]<<8)+b[p+6];width=(b[p+7]<<8)+b[p+8];break;}p+=length+2;}
 }else if(b.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'){
  mime='image/webp';const tag=ascii(12,16);
  if(tag==='VP8X'){width=1+b[24]+(b[25]<<8)+(b[26]<<16);height=1+b[27]+(b[28]<<8)+(b[29]<<16);}
  else if(tag==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42){width=(b[26]+(b[27]<<8))&16383;height=(b[28]+(b[29]<<8))&16383;}
  else if(tag==='VP8L'&&b[20]===47){width=1+b[21]+((b[22]&63)<<8);height=1+(b[22]>>6)+(b[23]<<2)+((b[24]&15)<<10);}
 }else if(ascii(0,5)==='%PDF-'){mime='application/pdf';}
 else throw Error('Formato no compatible. Usa JPEG, PNG, WebP o PDF digital de una página.');
 if(mime!=='application/pdf'&&(!width||!height||width>30000||height>30000||width*height>12000000))throw Error('Imagen inválida o demasiado grande: máximo 12 megapíxeles y 30.000 píxeles por lado.');
 return {mime,width,height,bytes:b.length};
}
const api={kinds,money,cents,date,reconcile,extractionSchema,validateExtraction,draftFromExtraction,inspectFile};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CASA_RECEIPTS=api;
})(typeof window!=='undefined'?window:globalThis);
