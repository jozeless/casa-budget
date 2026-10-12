-- Only the disposable PostgreSQL 17 database; never production.
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$
declare h uuid:='10000000-0000-0000-0000-000000000001';op uuid:='50000000-0000-0000-0000-000000000003';r jsonb;r2 jsonb;pid uuid;rev bigint;before_rows jsonb;t numeric;invalid_items jsonb;
begin
 -- Completed operations created by the old functions must still replay exactly.
 r=public.casa_save_purchase('50000000-0000-0000-0000-000000000001',h,null,null,'Historical manual','2026-10-01',10,'[{"name":"Historical product","quantity":1,"line_total":10}]');
 if r->'purchase'->>'store'<>'Historical manual' then raise exception 'Legacy manual replay changed';end if;
 r=public.casa_save_receipt('50000000-0000-0000-0000-000000000002',h,null,null,'Historical receipt','2026-10-01',11,'[{"name":"Historical gross product","quantity":1,"line_total":12}]','[{"kind":"discount","description":"Historical promotion","amount_cents":-100,"item_index":null}]',null);
 if r->'purchase'->>'store'<>'Historical receipt' then raise exception 'Legacy receipt replay changed';end if;
 r=public.casa_save_receipt(op,h,null,null,'Paid mismatch','2026-10-08',28.98,'[{"name":"Printed product","quantity":1,"line_total":31.57}]','[]',null);
 pid=(r->'purchase'->>'id')::uuid;rev=(r->'purchase'->>'revision')::bigint;
 if (r->'purchase'->>'total')::numeric<>28.98 or (r->'items'->0->>'line_total')::numeric<>31.57 or jsonb_array_length(r->'adjustments')<>0 then raise exception 'Independent values changed';end if;
 r2=public.casa_save_receipt(op,h,null,null,'Paid mismatch','2026-10-08',28.98,'[{"name":"Printed product","quantity":1,"line_total":31.57}]','[]',null);
 if r<>r2 or (select count(*) from public.purchases where id=pid)<>1 then raise exception 'Independent receipt retry duplicated';end if;
 begin perform public.casa_save_receipt(op,h,null,null,'Paid mismatch','2026-10-08',31.57,'[{"name":"Printed product","quantity":1,"line_total":31.57}]','[]',null);raise exception 'Changed pending payload accepted';exception when raise_exception then if sqlerrm='Changed pending payload accepted' then raise;end if;end;
 -- Manual contract must remain strict on inserts and edits, even for receipts without adjustments.
 begin perform public.casa_save_purchase(gen_random_uuid(),h,null,null,'Manual mismatch','2026-10-08',28.98,'[{"name":"Printed product","quantity":1,"line_total":31.57}]');raise exception 'Manual mismatch accepted';exception when raise_exception then if sqlerrm<>'La suma de productos no coincide con el total' then raise;end if;end;
 begin perform public.casa_save_purchase(gen_random_uuid(),h,pid,rev,'Manual edit','2026-10-08',28.98,'[{"name":"Printed product","quantity":1,"line_total":31.57}]');raise exception 'Manual edit mismatch accepted';exception when raise_exception then if sqlerrm<>'La suma de productos no coincide con el total' then raise;end if;end;
 if (select store from public.purchases where id=pid)<>'Paid mismatch' then raise exception 'Failed manual edit changed purchase';end if;
 -- Independent totals do not relax total validation or individual product validation.
 foreach t in array array[null,0,-1,28.981,'NaN'::numeric,'Infinity'::numeric] loop
  begin perform public.casa_save_receipt(gen_random_uuid(),h,null,null,'Invalid total','2026-10-08',t,'[{"name":"P","quantity":1,"line_total":31.57}]','[]',null);raise exception 'Invalid total accepted';exception when raise_exception then if sqlerrm='Invalid total accepted' then raise;end if;end;
 end loop;
 for invalid_items in select value from jsonb_array_elements('[ [{"name":"P","quantity":null,"line_total":31.57}], [{"name":"P","quantity":0,"line_total":31.57}], [{"name":"","quantity":1,"line_total":31.57}], [{"name":"P","quantity":1,"line_total":null}], [{"name":"P","quantity":1,"line_total":-1}] ]'::jsonb) loop
  begin perform public.casa_save_receipt(gen_random_uuid(),h,null,null,'Invalid item','2026-10-08',28.98,invalid_items,'[]',null);raise exception 'Invalid item accepted';exception when raise_exception then if sqlerrm='Invalid item accepted' then raise;end if;end;
 end loop;
 -- A failing product insert must roll back the edited total, lines and revision.
 select jsonb_build_object('p',to_jsonb(p),'i',(select jsonb_agg(i order by i.id) from public.purchase_items i where purchase_id=pid)) into before_rows from public.purchases p where id=pid;
 begin perform public.casa_save_receipt(gen_random_uuid(),h,pid,rev,'Partial write','2026-10-08',29.98,'[{"name":"FAIL","quantity":1,"line_total":31.57}]','[]',null);raise exception 'Partial receipt accepted';exception when raise_exception then if sqlerrm<>'Fixture insert failure' then raise;end if;end;
 select jsonb_build_object('p',to_jsonb(p),'i',(select jsonb_agg(i order by i.id) from public.purchase_items i where purchase_id=pid)) into r2 from public.purchases p where id=pid;
 if before_rows<>r2 then raise exception 'Failed edit lost original rows';end if;
 -- Edit can change paid total independently; general discounts remain separate and unallocated.
 r=public.casa_save_receipt(gen_random_uuid(),h,pid,rev,'Paid edit','2026-10-08',27.98,'[{"name":"Printed product","quantity":1,"line_total":31.57}]','[{"kind":"discount","description":"Real printed promotion","amount_cents":-100,"item_index":null}]',null);
 if (r->'purchase'->>'id')::uuid<>pid or (r->'purchase'->>'total')::numeric<>27.98 or (r->'items'->0->>'line_total')::numeric<>31.57 or (r->'adjustments'->0->>'amount_cents')::bigint<>-100 or r->'adjustments'->0->>'item_id' is not null then raise exception 'Edit allocated discount or changed identity';end if;
 begin perform public.casa_save_receipt(gen_random_uuid(),h,pid,rev,'Stale','2026-10-08',25,'[]','[]',null);raise exception 'Stale paid edit accepted';exception when serialization_failure then null;end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
 if exists(select 1 from public.purchases where id=pid) then raise exception 'Cross-household read';end if;
 begin perform public.casa_save_receipt(gen_random_uuid(),h,pid,rev,'Foreign','2026-10-08',28.98,'[]','[]',null);raise exception 'Cross-household edit accepted';exception when insufficient_privilege then null;end;
 begin perform public.casa_save_receipt(gen_random_uuid(),'10000000-0000-0000-0000-000000000002',pid,rev,'Moved','2026-10-08',28.98,'[]','[]',null);raise exception 'Foreign receipt moved';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',false);
 begin perform public.casa_save_receipt(gen_random_uuid(),h,null,null,'No session','2026-10-08',28.98,'[]','[]',null);raise exception 'Unauthenticated receipt accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
