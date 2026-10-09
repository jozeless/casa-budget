-- Review and run manually on the CASA project only, after an isolated test and backup.
-- Additive: no historical rows are deleted, renamed or grouped. Existing RLS remains.
begin;
alter table public.purchases add column if not exists revision bigint not null default 0;
create table if not exists public.purchase_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  household_id uuid not null references public.households(id) on delete cascade,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,operation_id)
);
alter table public.purchase_operations enable row level security;
revoke all on public.purchase_operations from public,anon,authenticated;

create or replace function public.casa_product_key(p_name text) returns text
language sql immutable strict set search_path='' as $$
 select lower(regexp_replace(regexp_replace(p_name, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'))
$$;

create index if not exists purchase_items_name_key_idx on public.purchase_items(public.casa_product_key(name));

-- Detect edits from the old client too; details are part of the purchase revision.
create or replace function public.casa_bump_revision() returns trigger
language plpgsql set search_path='' as $$
begin new.revision=old.revision+1;return new;end $$;
drop trigger if exists casa_purchase_revision on public.purchases;
create trigger casa_purchase_revision before update on public.purchases
for each row execute function public.casa_bump_revision();
create or replace function public.casa_items_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op <> 'INSERT' then update public.purchases set revision=revision where id=old.purchase_id;end if;
 if tg_op <> 'DELETE' and (tg_op='INSERT' or new.purchase_id is distinct from old.purchase_id) then
  update public.purchases set revision=revision where id=new.purchase_id;
 end if;
 return null;
end $$;
drop trigger if exists casa_item_revision on public.purchase_items;
create trigger casa_item_revision after insert or update or delete on public.purchase_items
for each row execute function public.casa_items_revision();

create or replace function public.casa_save_purchase(
 p_operation_id uuid,p_household_id uuid,p_purchase_id uuid,p_expected_revision bigint,
 p_store text,p_date date,p_total numeric,p_items jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid();v_payload jsonb;v_previous public.purchase_operations%rowtype;
 v_purchase public.purchases%rowtype;v_item jsonb;v_sum numeric:=0;v_result jsonb;v_id uuid;
begin
 if v_user is null then raise exception 'Debes iniciar sesión' using errcode='42501';end if;
 perform 1 from public.household_members where user_id=v_user and household_id=p_household_id for share;
 if not found then raise exception 'No perteneces al hogar' using errcode='42501';end if;
 if p_operation_id is null then raise exception 'Falta el identificador de operación';end if;
 v_payload=jsonb_build_object('household',p_household_id,'purchase',p_purchase_id,'revision',p_expected_revision,'store',p_store,'date',p_date,'total',p_total,'items',p_items);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||p_operation_id::text,0));
 select * into v_previous from public.purchase_operations where user_id=v_user and operation_id=p_operation_id;
 if found then
  if v_previous.payload<>v_payload then raise exception 'La operación pendiente tiene datos diferentes';end if;
  return v_previous.result;
 end if;
 if p_store is null or length(btrim(p_store)) not between 1 and 80 or p_date is null
 or p_total is null or p_total::text in ('NaN','Infinity','-Infinity') or p_total<=0 or p_total>9999999999.99 or p_total<>round(p_total,2)
 or p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Datos de compra no válidos';end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(v_item)<>'object' or v_item->>'name' is null or length(btrim(v_item->>'name')) not between 1 and 120
  or v_item->>'quantity' is null or v_item->>'line_total' is null then raise exception 'Producto no válido';end if;
  if (v_item->>'quantity')::numeric::text in ('NaN','Infinity','-Infinity') or (v_item->>'quantity')::numeric<=0
  or (v_item->>'quantity')::numeric>9999999.99 or (v_item->>'quantity')::numeric<>round((v_item->>'quantity')::numeric,2)
  or (v_item->>'line_total')::numeric::text in ('NaN','Infinity','-Infinity') or (v_item->>'line_total')::numeric<0
  or (v_item->>'line_total')::numeric>9999999999.99 or (v_item->>'line_total')::numeric<>round((v_item->>'line_total')::numeric,2) then raise exception 'Importe o cantidad no válido';end if;
  v_sum=v_sum+(v_item->>'line_total')::numeric;
 end loop;
 if jsonb_array_length(p_items)>0 and v_sum<>p_total then raise exception 'La suma de productos no coincide con el total';end if;
 if p_purchase_id is null then
  insert into public.purchases(household_id,created_by,store,purchased_on,total)
  values(p_household_id,v_user,btrim(p_store),p_date,p_total) returning id into v_id;
 else
  select * into v_purchase from public.purchases where id=p_purchase_id and household_id=p_household_id for update;
  if not found then raise exception 'Compra no disponible' using errcode='42501';end if;
  if p_expected_revision is null or v_purchase.revision<>p_expected_revision then raise exception 'La compra cambió. Vuelve a abrirla antes de editar.' using errcode='40001';end if;
  v_id=p_purchase_id;
  update public.purchases set store=btrim(p_store),purchased_on=p_date,total=p_total where id=v_id;
  delete from public.purchase_items where purchase_id=v_id;
 end if;
 insert into public.purchase_items(purchase_id,name,quantity,line_total)
 select v_id,btrim(value->>'name'),(value->>'quantity')::numeric,(value->>'line_total')::numeric from jsonb_array_elements(p_items);
 select jsonb_build_object('purchase',to_jsonb(p),'items',coalesce((select jsonb_agg(i order by i.id) from public.purchase_items i where i.purchase_id=v_id),'[]'::jsonb)) into v_result from public.purchases p where p.id=v_id;
 insert into public.purchase_operations(user_id,operation_id,household_id,payload,result) values(v_user,p_operation_id,p_household_id,v_payload,v_result);
 return v_result;
end $$;

create or replace function public.casa_product_history(p_household_id uuid,p_name text)
returns table(id uuid,purchase_id uuid,name text,quantity numeric,line_total numeric,store text,purchased_on date,total numeric,created_at timestamptz,revision bigint)
language sql stable security invoker set search_path='' as $$
 select i.id,i.purchase_id,i.name,i.quantity,i.line_total,p.store,p.purchased_on,p.total,p.created_at,p.revision
 from public.purchase_items i join public.purchases p on p.id=i.purchase_id
 where auth.uid() is not null and p.household_id=p_household_id
 and public.casa_product_key(i.name)=public.casa_product_key(p_name)
 order by p.purchased_on desc,p.id,i.id
$$;
revoke all on function public.casa_save_purchase(uuid,uuid,uuid,bigint,text,date,numeric,jsonb) from public,anon;
grant execute on function public.casa_save_purchase(uuid,uuid,uuid,bigint,text,date,numeric,jsonb) to authenticated;
revoke all on function public.casa_product_history(uuid,text) from public,anon;
grant execute on function public.casa_product_history(uuid,text) to authenticated;
revoke all on function public.casa_items_revision() from public,anon,authenticated;
revoke all on function public.casa_bump_revision() from public,anon,authenticated;
commit;
