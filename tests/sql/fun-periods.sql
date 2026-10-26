-- Isolated PostgreSQL only: freeze the business clock to test the November recharge.
create or replace function public.casa_budget_today() returns date language sql stable set search_path='' as $$select '2026-11-21'::date$$;
select public.casa_initialize_periods('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','2026-10-19');
select public.casa_initialize_periods('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','2026-10-19');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ declare h uuid:='10000000-0000-0000-0000-000000000001';p uuid;nextp jsonb;r jsonb;r2 jsonb;op uuid:=gen_random_uuid();funid uuid;begin
 select id into p from public.budget_periods where household_id=h and ends_on is null;
 r=public.casa_fun_write(op,h,null,null,20,'food','2026-10-19','Dinner');funid=(r->>'id')::uuid;
 r2=public.casa_fun_write(op,h,null,null,20,'food','2026-10-19','Dinner');if r<>r2 then raise exception 'FUN retry changed';end if;
 begin perform public.casa_fun_write(op,h,null,null,21,'food','2026-10-19','Dinner');raise exception 'Changed UUID accepted';exception when raise_exception then if sqlerrm='Changed UUID accepted' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
 r=public.casa_fun_write(gen_random_uuid(),h,funid,1,25,'hotel','2026-11-20','Shared edit');
 begin perform public.casa_fun_write(gen_random_uuid(),h,funid,1,25,'food','2026-11-20','Conflict');raise exception 'Stale FUN edit accepted';exception when serialization_failure then null;end;
 nextp=public.casa_start_period('60000000-0000-0000-0000-000000000001',h,p,'2026-11-20');
 r2=public.casa_start_period('60000000-0000-0000-0000-000000000001',h,p,'2026-11-20');if nextp<>r2 then raise exception 'Period retry changed';end if;
 if (nextp->>'purchases_budget')::numeric<>600 or (nextp->>'fun_budget')::numeric<>240 then raise exception 'Recharge not fixed';end if;
 if (select ends_on from public.budget_periods where id=p)<>'2026-11-20' then raise exception 'Wrong interval';end if;
 if (select count(*) from public.budget_periods where household_id=h)<>2 then raise exception 'Duplicate periods';end if;
 begin perform public.casa_start_period(gen_random_uuid(),h,p,'2026-11-20');raise exception 'Stale period accepted';exception when serialization_failure then null;end;
 begin perform public.casa_start_period(gen_random_uuid(),h,(nextp->>'id')::uuid,'2026-11-20');raise exception 'Same date accepted';exception when raise_exception then if sqlerrm='Same date accepted' then raise;end if;end;
 begin perform public.casa_start_period(gen_random_uuid(),h,(nextp->>'id')::uuid,'2026-11-22');raise exception 'Future date accepted';exception when raise_exception then if sqlerrm='Future date accepted' then raise;end if;end;
 begin perform public.casa_fun_write(gen_random_uuid(),h,null,null,1.001,'food','2026-11-20','');raise exception 'Decimals accepted';exception when raise_exception then if sqlerrm='Decimals accepted' then raise;end if;end;
 begin perform public.casa_fun_write(gen_random_uuid(),h,null,null,1,'other','2026-11-20','');raise exception 'Category accepted';exception when raise_exception then if sqlerrm='Category accepted' then raise;end if;end;
 begin update public.budget_periods set purchases_budget=1 where id=p;raise exception 'Direct period update accepted';exception when insufficient_privilege then null;end;
 begin insert into public.fun_expenses(household_id,amount,category,spent_on,created_by) values(h,1,'food','2026-11-20',auth.uid());raise exception 'Direct FUN write accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
 if exists(select 1 from public.fun_expenses) or exists(select 1 from public.budget_periods) then raise exception 'Foreign read';end if;
 begin perform public.casa_start_period(gen_random_uuid(),h,(nextp->>'id')::uuid,'2026-11-21');raise exception 'Foreign recharge';exception when insufficient_privilege then null;end;
 begin perform public.casa_fun_write(gen_random_uuid(),h,funid,2,1,'food','2026-11-20','',true);raise exception 'Foreign delete';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
 r=public.casa_fun_write('60000000-0000-0000-0000-000000000002',h,funid,2,25,'hotel','2026-11-20','Shared edit',true);
 r2=public.casa_fun_write('60000000-0000-0000-0000-000000000002',h,funid,2,25,'hotel','2026-11-20','Shared edit',true);if r<>r2 or exists(select 1 from public.fun_expenses where id=funid) then raise exception 'Delete not idempotent';end if;
end $$;
reset role;
do $$ declare h uuid:='10000000-0000-0000-0000-000000000001';begin
 begin update public.budget_periods set fun_budget=100 where household_id=h and ends_on is not null;raise exception 'Historical budget changed';exception when raise_exception then if sqlerrm='Historical budget changed' then raise;end if;end;
 begin insert into public.budget_periods(household_id,starts_on,ends_on) values(h,'2026-10-20','2026-10-25');raise exception 'Overlapping period accepted';exception when exclusion_violation then null;end;
end $$;
-- A failure AFTER closing the old period must roll back that close and the operation record.
create function public.fixture_period_failure() returns trigger language plpgsql as $$begin if new.starts_on='2026-11-21' then raise exception 'Injected period insert failure';end if;return new;end$$;
create trigger fixture_period_failure before insert on public.budget_periods for each row execute function public.fixture_period_failure();
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ declare p uuid;begin
 select id into p from public.budget_periods where household_id='10000000-0000-0000-0000-000000000001' and ends_on is null;
 begin perform public.casa_start_period('60000000-0000-0000-0000-000000000088','10000000-0000-0000-0000-000000000001',p,'2026-11-21');raise exception 'Injected failure did not happen';exception when raise_exception then if sqlerrm<>'Injected period insert failure' then raise;end if;end;
 if not exists(select 1 from public.budget_periods where id=p and ends_on is null) then raise exception 'Period close partially committed';end if;
end $$;
reset role;
do $$begin if exists(select 1 from public.budget_operations where operation_id='60000000-0000-0000-0000-000000000088') then raise exception 'Failed period operation persisted';end if;end$$;
drop trigger fixture_period_failure on public.budget_periods;
drop function public.fixture_period_failure();
-- New households initialize together, regardless of the deprecated monthly setting.
insert into auth.users(id) values('00000000-0000-0000-0000-000000000004');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
do $$declare h uuid;p public.budget_periods%rowtype;begin
 h=public.create_my_household('New period home',123);
 select * into p from public.budget_periods where household_id=h;
 if p.starts_on<>'2026-11-21' or p.purchases_budget<>600 or p.fun_budget<>240 or p.created_by<>auth.uid() then raise exception 'New household initialization incorrect';end if;
end $$;
reset role;
