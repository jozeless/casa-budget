-- CASA 3.3: apply manually after CASA 3.2, with a verified backup. No existing transaction DML.
begin;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create or replace function public.casa_budget_today() returns date language sql stable set search_path='' as $$select (now() at time zone 'Europe/Amsterdam')::date$$;
revoke all on function public.casa_budget_today() from public,anon,authenticated;
create table if not exists public.budget_periods (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id),
 starts_on date not null, ends_on date, purchases_budget numeric(12,2) not null default 600 check(purchases_budget>=0 and purchases_budget::text not in ('NaN','Infinity','-Infinity')),
 fun_budget numeric(12,2) not null default 240 check(fun_budget>=0 and fun_budget::text not in ('NaN','Infinity','-Infinity')),
 created_by uuid references auth.users(id), created_at timestamptz not null default now(),
 check(isfinite(starts_on) and (ends_on is null or (isfinite(ends_on) and ends_on>starts_on))), unique(household_id,starts_on)
);
-- Database-level exclusion also protects non-default transaction isolation levels.
do $$ declare ext_schema text;begin
 if not exists(select 1 from pg_constraint where conrelid='public.budget_periods'::regclass and conname='budget_periods_no_overlap') then
  select n.nspname into ext_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='btree_gist';
  execute format('alter table public.budget_periods add constraint budget_periods_no_overlap exclude using gist (household_id %I.gist_uuid_ops with =, daterange(starts_on,ends_on,''[)'') with &&)',ext_schema);
 end if;
end $$;
create unique index if not exists budget_periods_one_open on public.budget_periods(household_id) where ends_on is null;
create table if not exists public.fun_expenses (
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.households(id),
 amount numeric(12,2) not null check(amount>0 and amount::text not in ('NaN','Infinity','-Infinity')),category text not null check(category in ('Benzine/Parkeren','entree/tickets','food','overig','hotel')),
 spent_on date not null check(isfinite(spent_on)),description text not null default '' check(length(description)<=500),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),revision bigint not null default 1 check(revision>0)
);
create index if not exists fun_expenses_household_date on public.fun_expenses(household_id,spent_on,id);
create table if not exists public.budget_operations (
 user_id uuid not null references auth.users(id),operation_id uuid not null,household_id uuid not null references public.households(id),
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,operation_id)
);
alter table public.budget_periods enable row level security;
alter table public.fun_expenses enable row level security;
alter table public.budget_operations enable row level security;
revoke all on public.budget_periods,public.fun_expenses,public.budget_operations from public,anon,authenticated;
grant select on public.budget_periods,public.fun_expenses to authenticated;
drop policy if exists periods_members_read on public.budget_periods;
create policy periods_members_read on public.budget_periods for select to authenticated using(exists(select 1 from public.household_members m where m.household_id=budget_periods.household_id and m.user_id=auth.uid()));
drop policy if exists fun_members_read on public.fun_expenses;
create policy fun_members_read on public.fun_expenses for select to authenticated using(exists(select 1 from public.household_members m where m.household_id=fun_expenses.household_id and m.user_id=auth.uid()));
-- Serializes all period changes, including administrative inserts, without requiring an extension.
-- Row locking + overlap check + unique-open index enforce nonoverlap under concurrent requests.
create or replace function public.casa_period_integrity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Los períodos históricos no se eliminan';end if;
 perform 1 from public.households where id=new.household_id for update;
 if tg_op='UPDATE' then
  if (to_jsonb(new)-'ends_on') is distinct from (to_jsonb(old)-'ends_on') or old.ends_on is not null or new.ends_on is null then raise exception 'El período es inmutable salvo su primer cierre';end if;
 end if;
 if exists(select 1 from public.budget_periods p where p.household_id=new.household_id and p.id<>new.id and daterange(p.starts_on,p.ends_on,'[)') && daterange(new.starts_on,new.ends_on,'[)')) then raise exception 'Los períodos no pueden solaparse' using errcode='23P01';end if;
 return new;
end $$;
drop trigger if exists casa_period_integrity on public.budget_periods;
create trigger casa_period_integrity before insert or update or delete on public.budget_periods for each row execute function public.casa_period_integrity();
revoke all on function public.casa_period_integrity() from public,anon,authenticated;
-- ADMIN ONLY: explicitly supply the verified household/member UUIDs; never guesses a household.
create or replace function public.casa_initialize_periods(p_household_id uuid,p_member_id uuid,p_start date) returns uuid language plpgsql security definer set search_path='' as $$
declare first_period public.budget_periods%rowtype;v_id uuid;
begin
 perform 1 from public.households where id=p_household_id for update;
 if not found or not exists(select 1 from public.household_members where household_id=p_household_id and user_id=p_member_id) then raise exception 'Verifica hogar y miembro';end if;
 if p_start is null or p_start>public.casa_budget_today() then raise exception 'Fecha inicial inválida';end if;
 select * into first_period from public.budget_periods where household_id=p_household_id order by starts_on limit 1;
 if found then if first_period.starts_on<>p_start or first_period.purchases_budget<>600 or first_period.fun_budget<>240 then raise exception 'El hogar ya tiene otra inicialización';end if;return first_period.id;end if;
 insert into public.budget_periods(household_id,starts_on,created_by) values(p_household_id,p_start,p_member_id) returning id into v_id;return v_id;
end $$;
revoke all on function public.casa_initialize_periods(uuid,uuid,date) from public,anon,authenticated;
-- Only future household inserts get automatic initialization. Existing households remain untouched.
create or replace function public.casa_new_household_period() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.budget_periods(household_id,starts_on,created_by) values(new.id,public.casa_budget_today(),auth.uid());return new;
end $$;
drop trigger if exists casa_new_household_period on public.households;
create trigger casa_new_household_period after insert on public.households for each row execute function public.casa_new_household_period();
revoke all on function public.casa_new_household_period() from public,anon,authenticated;
create or replace function public.casa_start_period(p_operation_id uuid,p_household_id uuid,p_expected_period uuid,p_start date) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();old_period public.budget_periods%rowtype;v_payload jsonb;previous public.budget_operations%rowtype;v_result jsonb;
begin
 if u is null or not exists(select 1 from public.household_members where user_id=u and household_id=p_household_id) then raise exception 'No perteneces al hogar' using errcode='42501';end if;
 perform 1 from public.households where id=p_household_id for update;
 if p_operation_id is null then raise exception 'Falta identificador';end if;
 v_payload=jsonb_build_object('kind','start_period','household',p_household_id,'expected',p_expected_period,'date',p_start);
 select * into previous from public.budget_operations where user_id=u and operation_id=p_operation_id;
 if found then if previous.payload<>v_payload then raise exception 'La operación pendiente tiene datos diferentes';end if;return previous.result;end if;
 select * into old_period from public.budget_periods where household_id=p_household_id and ends_on is null for update;
 if not found or p_expected_period is null or old_period.id<>p_expected_period then raise exception 'El período cambió. Actualiza antes de recargar.' using errcode='40001';end if;
 if p_start is null or p_start<=old_period.starts_on or p_start>public.casa_budget_today() then raise exception 'La fecha debe ser posterior al inicio y no futura';end if;
 update public.budget_periods set ends_on=p_start where id=old_period.id;
 insert into public.budget_periods(household_id,starts_on,created_by) values(p_household_id,p_start,u) returning to_jsonb(budget_periods.*) into v_result;
 insert into public.budget_operations(user_id,operation_id,household_id,payload,result) values(u,p_operation_id,p_household_id,v_payload,v_result);return v_result;
end $$;
revoke all on function public.casa_start_period(uuid,uuid,uuid,date) from public,anon;
grant execute on function public.casa_start_period(uuid,uuid,uuid,date) to authenticated;
create or replace function public.casa_fun_write(p_operation_id uuid,p_household_id uuid,p_expense_id uuid,p_expected_revision bigint,p_amount numeric,p_category text,p_date date,p_description text,p_delete boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();previous public.budget_operations%rowtype;old_expense public.fun_expenses%rowtype;v_payload jsonb;v_result jsonb;
begin
 if u is null or not exists(select 1 from public.household_members where user_id=u and household_id=p_household_id) then raise exception 'No perteneces al hogar' using errcode='42501';end if;
 perform 1 from public.households where id=p_household_id for update;
 if p_operation_id is null or p_delete is null then raise exception 'Falta identificador/operación';end if;
 v_payload=jsonb_build_object('kind','fun','household',p_household_id,'id',p_expense_id,'revision',p_expected_revision,'amount',p_amount,'category',p_category,'date',p_date,'description',p_description,'delete',p_delete);
 select * into previous from public.budget_operations where user_id=u and operation_id=p_operation_id;
 if found then if previous.payload<>v_payload then raise exception 'La operación pendiente tiene datos diferentes';end if;return previous.result;end if;
 if not exists(select 1 from public.budget_periods where household_id=p_household_id and ends_on is null) then raise exception 'Inicializa los períodos CASA 3.3';end if;
 if p_expense_id is not null then
  select * into old_expense from public.fun_expenses where id=p_expense_id and household_id=p_household_id for update;
  if not found then raise exception 'Gasto no disponible' using errcode='42501';end if;
  if p_expected_revision is null or p_expected_revision<>old_expense.revision then raise exception 'El gasto cambió. Vuelve a abrirlo.' using errcode='40001';end if;
 end if;
 if p_delete then
  if p_expense_id is null then raise exception 'Falta gasto';end if;
  delete from public.fun_expenses where id=p_expense_id;v_result=jsonb_build_object('deleted',p_expense_id);
 else
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount>9999999999.99 or p_amount<>round(p_amount,2) or p_category is null or p_category not in ('Benzine/Parkeren','entree/tickets','food','overig','hotel') or p_date is null or p_description is null or length(p_description)>500 then raise exception 'Gasto FUN no válido';end if;
  if p_expense_id is null then
   insert into public.fun_expenses(household_id,amount,category,spent_on,description,created_by) values(p_household_id,p_amount,p_category,p_date,p_description,u) returning to_jsonb(fun_expenses.*) into v_result;
  else
   update public.fun_expenses set amount=p_amount,category=p_category,spent_on=p_date,description=p_description,revision=revision+1 where id=p_expense_id returning to_jsonb(fun_expenses.*) into v_result;
  end if;
 end if;
 insert into public.budget_operations(user_id,operation_id,household_id,payload,result) values(u,p_operation_id,p_household_id,v_payload,v_result);return v_result;
end $$;
revoke all on function public.casa_fun_write(uuid,uuid,uuid,bigint,numeric,text,date,text,boolean) from public,anon;
grant execute on function public.casa_fun_write(uuid,uuid,uuid,bigint,numeric,text,date,text,boolean) to authenticated;
commit;
