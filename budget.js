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
  const api={remainingBudget,productKey,productHistory,cents,monthKey,inMonth,total,weekly,evolution,normalize,history};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.CASA_BUDGET=api;
})(typeof window!=='undefined'?window:globalThis);
