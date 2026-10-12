// Requires Docker. Starts an isolated, temporary PostgreSQL; never uses config.js.
const {execFileSync,execFile}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const name='casa-phase2-'+process.pid,root=path.join(__dirname,'..');
const docker=(args,options={})=>execFileSync('docker',args,{stdio:['pipe','pipe','pipe'],...options});
const assert=require('node:assert/strict');const asyncExec=require('node:util').promisify(execFile);
const query=text=>asyncExec('docker',['exec',name,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-c',text]);
const sql=file=>docker(['exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:fs.readFileSync(path.join(root,file))});
(async()=>{try{
 docker(['run','--name',name,'--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
 let ready=false;for(let i=0;i<30;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,300));}}
 if(!ready)throw Error('PostgreSQL did not start');
 sql('tests/sql/bootstrap.sql');sql('tests/sql/receipts-bootstrap.sql');sql('schema.sql');docker(['exec',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-c','grant select,insert,update,delete on all tables in schema public to authenticated;']);
 sql('migrations/20261009_phase_2.sql');sql('migrations/20261009_phase_2.sql');sql('tests/sql/phase-2.sql');sql('migrations/20261010_smart_receipts.sql');sql('migrations/20261010_smart_receipts.sql');sql('tests/sql/receipts.sql');
 const prefix="set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';";
 const op='20000000-0000-0000-0000-000000000001',home='10000000-0000-0000-0000-000000000001';
 const call=prefix+`select public.casa_save_purchase('${op}','${home}',null,null,'Concurrent','2026-10-02',10,'[]');`;
 const both=await Promise.all([query(call),query(call)]);assert.equal(both[0].stdout,both[1].stdout);
 const saved=JSON.parse(both[0].stdout.trim().split('\n').at(-1));
 const edit=()=>prefix+`select public.casa_save_purchase(gen_random_uuid(),'${home}','${saved.purchase.id}',${saved.purchase.revision},'Concurrent edit','2026-10-02',20,'[]');`;
 const attempts=await Promise.allSettled([query(edit()),query(edit())]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.match(attempts.find(r=>r.status==='rejected').reason.stderr,/40001/);
 const smart=prefix+`select public.casa_save_receipt('40000000-0000-0000-0000-000000000010','${home}',null,null,'Smart concurrent','2026-10-02',5,'[{"name":"Product","quantity":1,"line_total":10}]','[{"kind":"discount","description":"Promo","amount_cents":-500,"item_index":0}]',null);`;
 const smartBoth=await Promise.all([query(smart),query(smart)]);assert.equal(smartBoth[0].stdout,smartBoth[1].stdout);const smartSaved=JSON.parse(smartBoth[0].stdout.trim().split('\n').at(-1));
 const smartEdit=()=>prefix+`select public.casa_save_receipt(gen_random_uuid(),'${home}','${smartSaved.purchase.id}',${smartSaved.purchase.revision},'Smart edit','2026-10-02',5,'[{"name":"Product","quantity":1,"line_total":10}]','[{"kind":"discount","description":"Promo","amount_cents":-500,"item_index":0}]',null);`;
 const smartAttempts=await Promise.allSettled([query(smartEdit()),query(smartEdit())]);assert.equal(smartAttempts.filter(r=>r.status==='fulfilled').length,1);assert.match(smartAttempts.find(r=>r.status==='rejected').reason.stderr,/40001/);
 const request='30000000-0000-0000-0000-000000000006';
 await query(prefix+`select public.casa_receipt_begin('${request}','${home}','image/png',100);`);
 const reserve=`set role service_role;select public.casa_receipt_claim('${request}','00000000-0000-0000-0000-000000000001',50,500);`;
 const reservations=await Promise.allSettled([query(reserve),query(reserve)]);assert.equal(reservations.filter(r=>r.status==='fulfilled').length,1);assert.match(reservations.find(r=>r.status==='rejected').reason.stderr,/55000/);
 await query(`update public.purchase_receipts set status='review',result='{}' where id='${request}';`);
 const cached=JSON.parse((await query(reserve)).stdout.trim().split('\n').at(-1));assert.equal(cached.cached,true);
 const attemptCount=(await query(`select count(*) from public.receipt_attempts where receipt_id='${request}';`)).stdout.trim();assert.equal(attemptCount,'1');
 console.log('Smart receipts: Jumbo reconciliation, injected rollback, Storage RLS, quotas, idempotency and concurrent edits passed.');
 console.log('Concurrent idempotent requests return one purchase; concurrent edits accept exactly one revision.');
 console.log('Isolated PostgreSQL 17 assertions passed, including applying the migration twice. Not a live Supabase test.');
}catch(error){console.error(error.stderr?.toString()||error.message);process.exitCode=1;}finally{try{docker(['stop',name]);}catch{}}})();
