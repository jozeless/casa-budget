/* Pure calendar and reporting helpers; never writes to Supabase. */
(function(root){
  'use strict';
  const cents=value=>Math.round(Number(value||0)*100);
  const monthKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  const inMonth=(purchases,month)=>purchases.filter(p=>p.purchased_on.slice(0,7)===month);
  const total=purchases=>purchases.reduce((sum,p)=>sum+cents(p.total),0);
  function weekly(budget,purchases,today=new Date()){
    const year=today.getFullYear(),month=today.getMonth(),day=today.getDate();
    const lastDay=new Date(year,month+1,0).getDate();
    const daysRemaining=lastDay-day+1;
    const daysToSunday=7-((today.getDay()+6)%7);
    const daysThisWeek=Math.min(daysToSunday,daysRemaining);
    const remaining=cents(budget)-total(inMonth(purchases,monthKey(today)));
    return {remaining,daysRemaining,daysThisWeek,amount:Math.round(Math.max(0,remaining)*daysThisWeek/daysRemaining),from:new Date(year,month,day),to:new Date(year,month,day+daysThisWeek-1)};
  }
  function evolution(purchases,today=new Date(),count=6){
    return Array.from({length:count},(_,index)=>{
      const date=new Date(today.getFullYear(),today.getMonth()-count+1+index,1);
      const month=monthKey(date);
      return {month,date,total:total(inMonth(purchases,month))};
    });
  }
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();
  function history(purchases,items,{month='',supermarket='',query=''}={}){
    const search=normalize(query);
    const matchingIds=new Set(items.filter(item=>normalize(item.name).includes(search)).map(item=>item.purchase_id));
    return purchases.filter(p=>(!month||p.purchased_on.startsWith(month))&&(!supermarket||p.store===supermarket)&&(!search||normalize(p.store).includes(search)||matchingIds.has(p.id)));
  }
  const productKey=value=>String(value??'').trim().replace(/\s+/gu,' ').toLocaleLowerCase('es');
  function productHistory(rows,month=''){
    const lines=rows.filter(row=>!month||row.purchased_on.startsWith(month));
    return {lines,total:lines.reduce((sum,row)=>sum+cents(row.line_total),0),count:new Set(lines.map(row=>row.purchase_id)).size};
  }
  function remainingBudget(budget,spent){
    const limit=cents(budget),balance=limit-cents(spent);
    const percentage=limit>0?Math.max(0,Math.min(100,balance/limit*100)):0;
    return {percentage,level:percentage>60?'high':percentage>30?'medium':'low',zeroBudget:limit===0};
  }
  const storeKey=value=>String(value??'').trim().toLocaleLowerCase('es');
  const calendarDate=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function weeklySpending(purchases,month){
    const [year,number]=month.split('-').map(Number),first=new Date(year,number-1,1),last=new Date(year,number,0);
    const cursor=new Date(year,number-1,1-((first.getDay()+6)%7)),totals=new Map();
    for(const purchase of inMonth(purchases,month)){
      const [y,m,d]=purchase.purchased_on.split('-').map(Number),date=new Date(y,m-1,d);
      date.setDate(date.getDate()-((date.getDay()+6)%7));const key=calendarDate(date);
      totals.set(key,(totals.get(key)||0)+cents(purchase.total));
    }
    const weeks=[];
    while(cursor<=last){
      const end=new Date(cursor.getFullYear(),cursor.getMonth(),cursor.getDate()+6),from=calendarDate(cursor);
      weeks.push({from,to:calendarDate(end),total:totals.get(from)||0});cursor.setDate(cursor.getDate()+7);
    }
    return weeks;
  }
  function dataIntelligence(purchases,items,month,budget,adjustments=[]){
    const all=[...new Map(purchases.map(p=>[p.id,p])).values()];
    const selected=inMonth(all,month),ids=new Set(selected.map(p=>p.id));
    const spent=total(selected),count=selected.length,limit=cents(budget),stores=new Map(),products=new Map();
    for(const purchase of selected){
      const key=storeKey(purchase.store);
      if(!stores.has(key))stores.set(key,{key,name:purchase.store.trim(),total:0,purchases:[]});
      const entry=stores.get(key);entry.total+=cents(purchase.total);entry.purchases.push(purchase);
    }
    for(const item of items){
      if(!ids.has(item.purchase_id))continue;
      const key=productKey(item.name);
      if(!products.has(key))products.set(key,{key,name:item.name.trim(),total:0,ids:new Set()});
      const entry=products.get(key);entry.total+=cents(item.line_total);entry.ids.add(item.purchase_id);
    }
    let generalAdjustments=0;
    for(const a of adjustments){if(!ids.has(a.purchase_id))continue;const item=a.item_id&&items.find(i=>i.id===a.item_id&&i.purchase_id===a.purchase_id);if(item){const entry=products.get(productKey(item.name));if(entry)entry.attributed=(entry.attributed||0)+Number(a.amount_cents);}else generalAdjustments+=Number(a.amount_cents);}
    const sort=(a,b)=>b.total-a.total||a.name.localeCompare(b.name,'es');
    const [year,number]=month.split('-').map(Number);
    return {generalAdjustments,summary:{spent,count,average:count?Math.round(spent/count):null,used:limit>0?spent/limit*100:null},
      stores:[...stores.values()].map(s=>({...s,percentage:spent?s.total/spent*100:0})).sort(sort),
      products:[...products.values()].map(p=>({key:p.key,name:p.name,total:p.total,count:p.ids.size,...(p.attributed?{attributed:p.attributed}:{})})).sort(sort),
      monthly:evolution(all,new Date(year,number-1,1)),weekly:weeklySpending(selected,month)};
  }
  function dataMonths(purchases,current,previous=''){
    const index=key=>{const [y,m]=key.split('-').map(Number);return y*12+m-1;};
    const end=index(current);let first=end-5,last=end;
    for(const key of [...purchases.map(p=>p.purchased_on.slice(0,7)),...(previous?[previous]:[])]){first=Math.min(first,index(key));last=Math.max(last,index(key));}
    return Array.from({length:last-first+1},(_,i)=>{const value=last-i;return `${String(Math.floor(value/12)).padStart(4,'0')}-${String(value%12+1).padStart(2,'0')}`;});
  }
  const api={dataMonths,storeKey,weeklySpending,dataIntelligence,remainingBudget,productKey,productHistory,cents,monthKey,inMonth,total,weekly,evolution,normalize,history};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.CASA_BUDGET=api;
})(typeof window!=='undefined'?window:globalThis);
