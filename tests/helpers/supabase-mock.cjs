// In-memory Supabase substitute. All mutations affect these fixtures only.
module.exports=function installMock(seed){
  const data={purchases:seed.purchases||[],items:seed.items||[],household:{id:'test-home',name:'Casa de prueba',monthly_budget:seed.budget??600,invite_code:'test-invite'}};
  const calls=[];const operations=new Map();
  data.purchases.forEach(p=>p.revision??=0);
  let session=seed.signedOut?null:{user:{id:'test-user',email:'test@example.com'},access_token:'synthetic-token'},callback;
  let nextId=0;
  class Query{
    constructor(table){this.table=table;this.filters=[];this.orders=[];this.operation='read';}
    select(columns){this.columns=columns;return this;}
    eq(key,value){this.filters.push(row=>row[key]===value);return this;}
    in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}
    order(key,options={}){this.orders.push([key,options.ascending!==false]);return this;}
    range(from,to){this.from=from;this.to=to;return this;}
    single(){this.one=true;return this;}
    maybeSingle(){this.one=true;return this;}
    insert(payload){this.operation='insert';this.payload=payload;return this;}
    update(payload){this.operation='update';this.payload=payload;return this;}
    delete(){this.operation='delete';return this;}
    then(resolve,reject){return this.execute().then(resolve,reject);}
    async execute(){
      calls.push({table:this.table,operation:this.operation,from:this.from,to:this.to});
      if(seed.noMigration&&this.table==='purchases'&&this.columns?.includes('revision'))return {data:null,error:{code:'42703',message:'Missing revision'}};
      if(seed.failHousehold&&this.operation==='read'&&this.table==='households')return {data:null,error:{message:'Simulated household failure'}};
      if(seed.failWrite&&this.operation!=='read')return {data:null,error:{message:'Simulated write failure'}};
      if(seed.failRead&&this.operation==='read'&&this.table==='purchases')return {data:null,error:{message:'Simulated network failure'}};
      if(seed.delay)await new Promise(resolve=>setTimeout(resolve,seed.delay));
      let rows=this.table==='household_members'?(seed.noHousehold?[]:[{user_id:'test-user',household_id:'test-home'}]):this.table==='households'?[data.household]:data[this.table==='purchase_items'?'items':this.table];
      if(this.operation==='insert'){
        const inserted=(Array.isArray(this.payload)?this.payload:[this.payload]).map(payload=>({...payload,id:'mock-'+(++nextId),created_at:new Date().toISOString()}));rows.push(...inserted);rows=inserted;
      }else if(this.operation==='delete'){
        const removed=rows.filter(row=>this.filters.every(filter=>filter(row)));
        data[this.table==='purchase_items'?'items':this.table]=rows.filter(row=>!removed.includes(row));
        if(this.table==='purchases')data.items=data.items.filter(item=>!removed.some(p=>p.id===item.purchase_id));
        rows=[];
      }else if(this.operation==='update'){
        rows.filter(row=>this.filters.every(filter=>filter(row))).forEach(row=>Object.assign(row,this.payload));
      }
      rows=rows.filter(row=>this.filters.every(filter=>filter(row))).slice();
      rows.sort((a,b)=>{for(const [key,ascending] of this.orders){const result=String(a[key]??'').localeCompare(String(b[key]??''));if(result)return ascending?result:-result;}return 0;});
      if(this.from!==undefined)rows=rows.slice(this.from,this.to+1);
      return {data:JSON.parse(JSON.stringify(this.one?(rows[0]||null):rows)),error:null};
    }
  }
  window.mock={data,calls,seed,emit(event,next=session){session=next;callback(event,next);}};
  window.supabase={createClient(){return {from(table){return new Query(table);},rpc(name,args){
 if(name==='casa_product_history'){
  const query={from:0,to:Infinity,order(){return this;},range(from,to){this.from=from;this.to=to;return this;},async then(resolve,reject){
   try{calls.push({operation:name,from:this.from,to:this.to});if(seed.failRead)throw Error('Simulated network failure');
    const key=value=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('es');
    const rows=data.items.flatMap(item=>{const p=data.purchases.find(p=>p.id===item.purchase_id&&p.household_id===args.p_household_id);return p&&key(item.name)===key(args.p_name)?[{...item,store:p.store,purchased_on:p.purchased_on,total:p.total,created_at:p.created_at,revision:p.revision}]:[];}).sort((a,b)=>b.purchased_on.localeCompare(a.purchased_on)||a.purchase_id.localeCompare(b.purchase_id)||a.id.localeCompare(b.id));
    resolve({data:JSON.parse(JSON.stringify(rows.slice(this.from,this.to+1))),error:null});
   }catch(error){resolve({data:null,error:{message:error.message}});}
  }};return query;
 }
 return (async()=>{calls.push({operation:name});
 if(name==='casa_save_purchase'){
  if(seed.noMigration)return {data:null,error:{code:'PGRST202',message:'Missing function'}};
  if(seed.delay)await new Promise(resolve=>setTimeout(resolve,seed.delay));
  if(seed.failWrite)return {data:null,error:{code:'42501',message:'Simulated write failure'}};
  if(args.p_household_id!==data.household.id)return {data:null,error:{code:'42501',message:'Not a household member'}};
  const signature=JSON.stringify(args),previous=operations.get(args.p_operation_id);
  if(previous)return previous.signature===signature?{data:JSON.parse(JSON.stringify(previous.result)),error:null}:{data:null,error:{code:'P0001',message:'Different operation payload'}};
  const existing=data.purchases.find(p=>p.id===args.p_purchase_id);
  if(args.p_purchase_id&&(!existing||existing.revision!==args.p_expected_revision))return {data:null,error:{code:'40001',message:'La compra cambió. Vuelve a abrirla antes de editar.'}};
  if(args.p_items.length&&Math.round(args.p_items.reduce((sum,i)=>sum+i.line_total,0)*100)!==Math.round(args.p_total*100))return {data:null,error:{code:'P0001',message:'Invalid item total'}};
  const purchase={...(existing||{id:'mock-'+(++nextId),household_id:args.p_household_id,created_by:'test-user',created_at:new Date().toISOString()}),store:args.p_store,purchased_on:args.p_date,total:args.p_total,revision:(existing?.revision||0)+1};
  const items=args.p_items.map(item=>({...item,id:'mock-item-'+(++nextId),purchase_id:purchase.id}));
  data.purchases=data.purchases.filter(p=>p.id!==purchase.id).concat(purchase);data.items=data.items.filter(i=>i.purchase_id!==purchase.id).concat(items);
  if(seed.failReadAfterWrite)seed.failRead=true;
  const result={purchase,items};operations.set(args.p_operation_id,{signature,result:JSON.parse(JSON.stringify(result))});
  if(seed.loseResponse){seed.loseResponse=false;return {data:null,error:{message:'Simulated lost response'}};}
  return {data:JSON.parse(JSON.stringify(result)),error:null};
 }
seed.noHousehold=false;if(name==='create_my_household'){data.household.name=args.p_name;data.household.monthly_budget=args.p_budget;}return {data:'test-home',error:null};})();},auth:{
    onAuthStateChange(fn){callback=fn;queueMicrotask(()=>fn('INITIAL_SESSION',session));return {data:{subscription:{unsubscribe(){}}}};},
    async initialize(){return {error:null};},async getSession(){return {data:{session},error:null};},
    async signInWithPassword(){session={user:{id:'test-user',email:'test@example.com'},access_token:'synthetic-token'};callback('SIGNED_IN',session);return {data:{user:session.user},error:null};},
    async signUp(){calls.push({operation:'signUp'});return {data:{session:null},error:null};},
    async signOut(){session=null;callback('SIGNED_OUT',null);return {error:null};},
    async resetPasswordForEmail(){calls.push({operation:'resetPassword'});return {error:null};},
    async updateUser(){calls.push({operation:'updatePassword'});return {error:null};},stopAutoRefresh(){}
  }};}};
};
