-- Run only in the disposable database created by scripts/check-sql.cjs.
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
insert into public.households(id,name) values('10000000-0000-0000-0000-000000000001','Fixture home'),('10000000-0000-0000-0000-000000000002','Other home');
insert into public.household_members(household_id,user_id) values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
create function public.fixture_reject_item() returns trigger language plpgsql as $$begin if new.name='FAIL' then raise exception 'Fixture insert failure';end if;return new;end$$;
create trigger fixture_reject before insert on public.purchase_items for each row execute function public.fixture_reject_item();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$
declare h uuid:='10000000-0000-0000-0000-000000000001';op uuid:=gen_random_uuid();r jsonb;r2 jsonb;pid uuid;rev bigint;before_result jsonb;n integer;
begin
 r=public.casa_save_purchase(op,h,null,null,'Jumbo','2026-10-01',20,'[{"name":" Café ","quantity":2,"line_total":20}]');pid=(r->'purchase'->>'id')::uuid;
 r2=public.casa_save_purchase(op,h,null,null,'Jumbo','2026-10-01',20,'[{"name":" Café ","quantity":2,"line_total":20}]');
 if r<>r2 or (select count(*) from public.purchases)<>1 then raise exception 'Idempotency failed';end if;
 begin perform public.casa_save_purchase(op,h,null,null,'Jumbo','2026-10-01',30,'[]');raise exception 'Payload mismatch accepted';exception when raise_exception then if sqlerrm='Payload mismatch accepted' then raise;end if;end;
 rev=(r->'purchase'->>'revision')::bigint;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
 r2=public.casa_save_purchase(gen_random_uuid(),h,pid,rev,'Lidl','2026-11-01',30,'[{"name":"Café","quantity":3,"line_total":30}]');
 if r2->'purchase'->>'id'<>pid::text or r2->'purchase'->>'created_by'<>'00000000-0000-0000-0000-000000000001' or (select count(*) from public.purchases)<>1 then raise exception 'Edit identity failed';end if;
 begin perform public.casa_save_purchase(gen_random_uuid(),h,pid,rev,'Lidl','2026-11-01',40,'[]');raise exception 'Conflict accepted';exception when serialization_failure then null;end;
 rev=(r2->'purchase'->>'revision')::bigint;before_result=r2;
 begin perform public.casa_save_purchase(gen_random_uuid(),h,pid,rev,'Aldi','2026-12-01',40,'[{"name":"FAIL","quantity":1,"line_total":40}]');raise exception 'Partial save accepted';exception when raise_exception then if sqlerrm<>'Fixture insert failure' then raise;end if;end;
 select jsonb_build_object('purchase',to_jsonb(p),'items',(select jsonb_agg(i order by i.id) from public.purchase_items i where purchase_id=pid)) into r2 from public.purchases p where id=pid;
 if r2<>before_result then raise exception 'Rollback did not preserve purchase and products';end if;
 begin perform public.casa_save_purchase(gen_random_uuid(),h,pid,rev,'Lidl','2026-11-01',30,'[{"name":"Café","quantity":1,"line_total":29}]');raise exception 'Unequal totals accepted';exception when raise_exception then if sqlerrm='Unequal totals accepted' then raise;end if;end;
 if (select count(*) from public.casa_product_history(h,'  CAFÉ  '))<>1 or (select count(*) from public.casa_product_history(h,'Cafe'))<>0 then raise exception 'Product identity failed';end if;
 -- Existing insert permissions cannot conceal a stale detailed edit.
 insert into public.purchase_items(purchase_id,name,quantity,line_total) values(pid,'Extra',1,0);
 begin perform public.casa_save_purchase(gen_random_uuid(),h,pid,rev,'Lidl','2026-11-01',30,'[]');raise exception 'Old-client item conflict accepted';exception when serialization_failure then null;end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
 if (select count(*) from public.casa_product_history(h,'Café'))<>0 then raise exception 'Cross-household read allowed';end if;
 begin perform public.casa_save_purchase(gen_random_uuid(),h,pid,rev,'Lidl','2026-11-01',30,'[]');raise exception 'Cross-household write allowed';exception when insufficient_privilege then null;end;
 begin perform public.casa_save_purchase(gen_random_uuid(),'10000000-0000-0000-0000-000000000002',pid,rev,'Lidl','2026-11-01',30,'[]');raise exception 'Foreign purchase moved to own household';exception when insufficient_privilege then null;end;
 begin perform 1 from public.purchase_operations;raise exception 'Operation records exposed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',false);
 begin perform public.casa_save_purchase(gen_random_uuid(),h,null,null,'Jumbo','2026-10-01',20,'[]');raise exception 'Unauthenticated write allowed';exception when insufficient_privilege then null;end;
 raise notice 'SQL assertions passed: atomic rollback, identity, totals, idempotency, revisions, old-client conflicts, membership, RLS and operation privacy';
end$$;
reset role;
do $$begin
 if (select count(*) from public.purchase_operations)<>2 then raise exception 'Failed operations leaked out of rollback';end if;
 if public.casa_product_key(E'\t CAFÉ \n')<>'café' then raise exception 'Whitespace normalization failed';end if;
 if has_function_privilege('anon','public.casa_save_purchase(uuid,uuid,uuid,bigint,text,date,numeric,jsonb)','execute') then raise exception 'Anonymous RPC access';end if;
end$$;
