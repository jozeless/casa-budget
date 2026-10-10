set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select public.casa_receipt_begin('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','image/png',100);
insert into storage.objects(bucket_id,name) values('receipts','10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/original');
reset role;
update public.purchase_receipts set status='review',result='{}' where id='30000000-0000-0000-0000-000000000001';
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$
declare first jsonb;second jsonb;edited jsonb;pid uuid;revision bigint;
begin
 first=public.casa_save_receipt('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',null,null,'Jumbo','2026-10-08',46.88,'[{"name":"Eight recorded products","quantity":8,"line_total":81.83}]','[{"kind":"discount","description":"Promotion","amount_cents":-3495,"item_index":null}]','30000000-0000-0000-0000-000000000001');
 second=public.casa_save_receipt('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',null,null,'Jumbo','2026-10-08',46.88,'[{"name":"Eight recorded products","quantity":8,"line_total":81.83}]','[{"kind":"discount","description":"Promotion","amount_cents":-3495,"item_index":null}]','30000000-0000-0000-0000-000000000001');
 if first<>second then raise exception 'Retry not idempotent';end if;
 pid=(first->'purchase'->>'id')::uuid;revision=(first->'purchase'->>'revision')::bigint;
 if (select count(*) from public.purchase_adjustments where purchase_id=pid)<>1 then raise exception 'Missing adjustment';end if;
 begin perform public.casa_save_receipt(gen_random_uuid(),'10000000-0000-0000-0000-000000000001',pid,revision,'Broken','2026-10-08',46.88,'[{"name":"P","quantity":1,"line_total":81.83}]','[{"kind":"discount","description":"Discount","amount_cents":-3494,"item_index":null}]',null);raise exception 'Accepted mismatch';exception when raise_exception then if sqlerrm='Accepted mismatch' then raise;end if;end;
 if (select store from public.purchases where id=pid)<>'Jumbo' then raise exception 'Partial save';end if;
 begin perform public.casa_save_purchase(gen_random_uuid(),'10000000-0000-0000-0000-000000000001',pid,revision,'Old','2026-10-08',46.88,'[]');raise exception 'Legacy erased discounts';exception when raise_exception then if sqlerrm='Legacy erased discounts' then raise;end if;end;
 edited=public.casa_save_receipt(gen_random_uuid(),'10000000-0000-0000-0000-000000000001',pid,revision,'Jumbo edited','2026-10-08',46.88,'[{"name":"Product","quantity":1,"line_total":81.83}]','[{"kind":"discount","description":"Explicit product discount","amount_cents":-3495,"item_index":0}]',null);
 if (edited->'adjustments'->0->>'item_id') is null then raise exception 'Attribution lost';end if;
 begin perform public.casa_save_receipt(gen_random_uuid(),'10000000-0000-0000-0000-000000000001',pid,revision,'Conflict','2026-10-08',46.88,'[]','[]',null);raise exception 'Accepted stale revision';exception when serialization_failure then null;end;
 delete from public.purchases where id=pid;
 if exists(select 1 from public.purchase_adjustments where purchase_id=pid) then raise exception 'Adjustment not deleted';end if;
 if not exists(select 1 from public.purchase_receipts where id='30000000-0000-0000-0000-000000000001' and purchase_id is null and path is not null) then raise exception 'Receipt automatically deleted';end if;
end $$;
-- Inject a failure AFTER purchase/products were written; the whole operation must roll back.
reset role;
create function public.casa_test_adjustment_failure() returns trigger language plpgsql as $$ begin if new.description='fail-after-products' then raise exception 'Injected adjustment failure';end if;return new;end $$;
create trigger casa_test_adjustment_failure before insert on public.purchase_adjustments for each row execute function public.casa_test_adjustment_failure();
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ declare old_count integer;begin
 select count(*) into old_count from public.purchases;
 begin perform public.casa_save_receipt('40000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001',null,null,'Atomic failed','2026-10-08',5,'[{"name":"Written before failure","quantity":1,"line_total":10}]','[{"kind":"discount","description":"fail-after-products","amount_cents":-500,"item_index":0}]',null);raise exception 'Failure missing';exception when raise_exception then if sqlerrm='Failure missing' then raise;end if;end;
 if (select count(*) from public.purchases)<>old_count or exists(select 1 from public.purchase_items where name='Written before failure') then raise exception 'Partial accounting committed';end if;
end $$;
reset role;
do $$ begin if exists(select 1 from public.purchase_operations where operation_id='40000000-0000-0000-0000-000000000009') then raise exception 'Failed operation persisted';end if;end $$;
drop trigger casa_test_adjustment_failure on public.purchase_adjustments;
drop function public.casa_test_adjustment_failure();
set role authenticated;
-- Foreign household cannot read, upload, delete or associate an object.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
do $$ begin
 if exists(select 1 from public.purchase_receipts) or exists(select 1 from storage.objects) then raise exception 'Cross-household leak';end if;
 begin perform public.casa_receipt_begin('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','image/png',100);raise exception 'Foreign begin';exception when insufficient_privilege then null;end;
 begin perform public.casa_receipt_forget_file('30000000-0000-0000-0000-000000000001');raise exception 'Foreign forget';exception when insufficient_privilege then null;end;
 begin perform public.casa_receipt_claim('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',40);raise exception 'Client reserved costs';exception when insufficient_privilege then null;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
delete from storage.objects where bucket_id='receipts';
select public.casa_receipt_forget_file('30000000-0000-0000-0000-000000000001');
select public.casa_receipt_begin('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','image/png',100);
reset role;
set role service_role;
select public.casa_receipt_claim('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',1);
do $$ begin
 begin perform public.casa_receipt_claim('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',1);raise exception 'Concurrent claim accepted';exception when object_not_in_prerequisite_state then null;end;
end $$;
reset role;
update public.purchase_receipts set status='error' where id='30000000-0000-0000-0000-000000000002';
set role service_role;
do $$ begin
 begin perform public.casa_receipt_claim('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',1);raise exception 'Quota bypass';exception when program_limit_exceeded then null;end;
end $$;
reset role;
