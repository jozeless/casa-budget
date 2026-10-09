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
 sql('tests/sql/bootstrap.sql');sql('schema.sql');docker(['exec',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-c','grant select,insert,update,delete on all tables in schema public to authenticated;']);
 sql('migrations/20261009_phase_2.sql');sql('migrations/20261009_phase_2.sql');sql('tests/sql/phase-2.sql');
 const prefix="set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';";
 const op='20000000-0000-0000-0000-000000000001',home='10000000-0000-0000-0000-000000000001';
 const call=prefix+`select public.casa_save_purchase('${op}','${home}',null,null,'Concurrent','2026-10-02',10,'[]');`;
 const both=await Promise.all([query(call),query(call)]);assert.equal(both[0].stdout,both[1].stdout);
 const saved=JSON.parse(both[0].stdout.trim().split('\n').at(-1));
 const edit=()=>prefix+`select public.casa_save_purchase(gen_random_uuid(),'${home}','${saved.purchase.id}',${saved.purchase.revision},'Concurrent edit','2026-10-02',20,'[]');`;
 const attempts=await Promise.allSettled([query(edit()),query(edit())]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.match(attempts.find(r=>r.status==='rejected').reason.stderr,/40001/);
 console.log('Concurrent idempotent requests return one purchase; concurrent edits accept exactly one revision.');
 console.log('Isolated PostgreSQL 17 assertions passed, including applying the migration twice. Not a live Supabase test.');
}catch(error){console.error(error.stderr?.toString()||error.message);process.exitCode=1;}finally{try{docker(['stop',name]);}catch{}}})();
