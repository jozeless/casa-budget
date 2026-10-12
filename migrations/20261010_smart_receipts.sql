-- Apply manually AFTER phase 2, backup and isolated tests. No historical data rewriting.
begin;
create table if not exists public.purchase_receipts (
 id uuid primary key, household_id uuid not null references public.households(id), created_by uuid not null references auth.users(id),
 purchase_id uuid unique references public.purchases(id) on delete set null, path text unique,
 mime text not null check(mime in ('image/jpeg','image/png','image/webp','application/pdf')),
 bytes bigint not null check(bytes between 1 and 10485760),
 status text not null default 'upload_pending' check(status in ('upload_pending','processing','review','confirmed','error','cancelled')),
 result jsonb, model text, input_tokens integer, output_tokens integer, error_code text, started_at timestamptz, created_at timestamptz not null default now(),
 check(path is null or path=household_id::text||'/'||id::text||'/original')
);
create table if not exists public.purchase_adjustments (
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.purchases(id) on delete cascade,
 kind text not null check(kind in ('discount','deposit','return','rounding','other')),
 description text not null check(length(btrim(description)) between 1 and 160),
 amount_cents bigint not null check(amount_cents between -999999999999 and 999999999999),
 item_id uuid references public.purchase_items(id) on delete set null
);
create index if not exists purchase_adjustments_purchase_idx on public.purchase_adjustments(purchase_id);
create index if not exists purchase_receipts_household_idx on public.purchase_receipts(household_id,created_at);
create table if not exists public.receipt_attempts (id uuid primary key default gen_random_uuid(),household_id uuid not null references public.households(id),receipt_id uuid not null references public.purchase_receipts(id),created_at timestamptz not null default now());
create index if not exists receipt_attempts_time_idx on public.receipt_attempts(created_at,household_id);
alter table public.purchase_adjustments enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.receipt_attempts enable row level security;
revoke all on public.purchase_receipts,public.purchase_adjustments,public.receipt_attempts from public,anon,authenticated;
grant select on public.purchase_receipts,public.purchase_adjustments to authenticated;
grant all on public.purchase_receipts,public.receipt_attempts to service_role;
drop policy if exists receipts_members_read on public.purchase_receipts;
create policy receipts_members_read on public.purchase_receipts for select to authenticated using(exists(select 1 from public.household_members where household_id=purchase_receipts.household_id and user_id=auth.uid()));
drop policy if exists adjustments_members_read on public.purchase_adjustments;
create policy adjustments_members_read on public.purchase_adjustments for select to authenticated using(exists(select 1 from public.purchases p join public.household_members m on m.household_id=p.household_id where p.id=purchase_adjustments.purchase_id and m.user_id=auth.uid()));
create or replace function public.casa_adjustments_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op<>'INSERT' then update public.purchases set revision=revision where id=old.purchase_id;end if;
 if tg_op<>'DELETE' and (tg_op='INSERT' or new.purchase_id is distinct from old.purchase_id) then update public.purchases set revision=revision where id=new.purchase_id;end if;
 return null;
end $$;
drop trigger if exists casa_adjustment_revision on public.purchase_adjustments;
create trigger casa_adjustment_revision after insert or update or delete on public.purchase_adjustments for each row execute function public.casa_adjustments_revision();
revoke all on function public.casa_adjustments_revision() from public,anon,authenticated;
create or replace function public.casa_receipt_begin(p_id uuid,p_household_id uuid,p_mime text,p_bytes bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.household_members where user_id=auth.uid() and household_id=p_household_id) then raise exception 'No perteneces al hogar' using errcode='42501';end if;
 if p_id is null then raise exception 'Solicitud inválida';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text,0));
 if not exists(select 1 from public.purchase_receipts where id=p_id) and ((select count(*) from public.purchase_receipts where household_id=p_household_id and created_at>now()-interval '24 hours')>=100 or (select count(*) from public.purchase_receipts where household_id=p_household_id and status in ('upload_pending','error','review','processing') and path is not null)>=20) then raise exception 'Demasiados recibos pendientes. Revisa el almacenamiento.' using errcode='54000';end if;
 insert into public.purchase_receipts(id,household_id,created_by,path,mime,bytes) values(p_id,p_household_id,auth.uid(),p_household_id::text||'/'||p_id::text||'/original',p_mime,p_bytes) on conflict(id) do nothing;
 select * into r from public.purchase_receipts where id=p_id;
 if r.household_id<>p_household_id or r.created_by<>auth.uid() or r.mime<>p_mime or r.bytes<>p_bytes then raise exception 'Solicitud incompatible' using errcode='42501';end if;
 return to_jsonb(r);
end $$;
-- Service-only reservation. No automatic reclaim: a lost response might already be billed.
create or replace function public.casa_receipt_claim(p_id uuid,p_user uuid,p_daily_limit integer default 40,p_global_limit integer default 200)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts%rowtype;
begin
 select * into r from public.purchase_receipts where id=p_id;
 if not found or r.path is null or not exists(select 1 from public.household_members where household_id=r.household_id and user_id=p_user) then raise exception 'Recibo no disponible' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('casa-receipt-global-quota',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.household_id::text,0));
 select * into r from public.purchase_receipts where id=p_id for update;
 if r.status in ('review','confirmed') and r.result is not null then return jsonb_build_object('cached',true,'receipt',to_jsonb(r));end if;
 if r.status='cancelled' then raise exception 'Recibo cancelado';end if;
 if exists(select 1 from public.purchase_receipts where household_id=r.household_id and status='processing') then raise exception 'Extracción en curso. No vuelvas a enviarla.' using errcode='55000';end if;
 if p_global_limit not between 1 and 10000 or (select count(*) from public.receipt_attempts where created_at>now()-interval '24 hours')>=p_global_limit then raise exception 'Límite global de extracción alcanzado' using errcode='54000';end if;
 if p_daily_limit not between 1 and 1000 or (select count(*) from public.receipt_attempts where household_id=r.household_id and created_at>now()-interval '24 hours')>=p_daily_limit then raise exception 'Límite diario de recibos alcanzado' using errcode='54000';end if;
 insert into public.receipt_attempts(household_id,receipt_id) values(r.household_id,r.id);
 update public.purchase_receipts set status='processing',started_at=now(),error_code=null where id=r.id returning * into r;
 return jsonb_build_object('cached',false,'receipt',to_jsonb(r));
end $$;
create or replace function public.casa_receipt_cancel(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts%rowtype;
begin
 select * into r from public.purchase_receipts where id=p_id for update;
 if not found or not exists(select 1 from public.household_members where household_id=r.household_id and user_id=auth.uid()) then raise exception 'Recibo no disponible' using errcode='42501';end if;
 if r.purchase_id is not null then raise exception 'El recibo ya está guardado';end if;
 if r.status='processing' then raise exception 'Espera a que termine la extracción';end if;
 update public.purchase_receipts set status='cancelled' where id=p_id;
end $$;
-- Called after successful Storage deletion. Preserve accounting and extraction metadata.
create or replace function public.casa_receipt_forget_file(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.purchase_receipts%rowtype;
begin
 select * into r from public.purchase_receipts where id=p_id for update;
 if not found or not exists(select 1 from public.household_members where household_id=r.household_id and user_id=auth.uid()) then raise exception 'Recibo no disponible' using errcode='42501';end if;
 if r.status='processing' then raise exception 'Extracción en curso';end if;
 if exists(select 1 from storage.objects where bucket_id='receipts' and name=r.path) then raise exception 'El archivo todavía existe';end if;
 update public.purchase_receipts set path=null where id=p_id;
end $$;
create or replace function public.casa_save_receipt(p_operation_id uuid,p_household_id uuid,p_purchase_id uuid,p_expected_revision bigint,p_store text,p_date date,p_total numeric,p_items jsonb,p_adjustments jsonb,p_receipt_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();v_payload jsonb;v_previous public.purchase_operations%rowtype;p public.purchases%rowtype;r public.purchase_receipts%rowtype;
 item jsonb;adj jsonb;sum_cents numeric:=0;v_id uuid;item_ids uuid[]:='{}';iid uuid;v_result jsonb;idx integer;
begin
 if u is null or not exists(select 1 from public.household_members where user_id=u and household_id=p_household_id) then raise exception 'No perteneces al hogar' using errcode='42501';end if;
 if p_operation_id is null then raise exception 'Falta identificador';end if;
 v_payload=jsonb_build_object('household',p_household_id,'purchase',p_purchase_id,'revision',p_expected_revision,'store',p_store,'date',p_date,'total',p_total,'items',p_items,'adjustments',p_adjustments,'receipt',p_receipt_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||p_operation_id::text,0));
 select * into v_previous from public.purchase_operations where user_id=u and operation_id=p_operation_id;
 if found then if v_previous.payload<>v_payload then raise exception 'La operación pendiente tiene datos diferentes';end if;return v_previous.result;end if;
 if p_store is null or length(btrim(p_store)) not between 1 and 80 or p_date is null or p_total is null or p_total::text in ('NaN','Infinity','-Infinity') or p_total<=0 or p_total>9999999999.99 or p_total<>round(p_total,2)
 or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>500 or p_adjustments is null or jsonb_typeof(p_adjustments)<>'array' or jsonb_array_length(p_adjustments)>100 then raise exception 'Datos no válidos';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' or item->>'name' is null or length(btrim(item->>'name')) not between 1 and 120 or item->>'quantity' is null or item->>'line_total' is null then raise exception 'Producto no válido';end if;
  if (item->>'quantity')::numeric::text in ('NaN','Infinity','-Infinity') or (item->>'quantity')::numeric<=0 or (item->>'quantity')::numeric>9999999.99 or (item->>'quantity')::numeric<>round((item->>'quantity')::numeric,2)
  or (item->>'line_total')::numeric::text in ('NaN','Infinity','-Infinity') or (item->>'line_total')::numeric<0 or (item->>'line_total')::numeric>9999999999.99 or (item->>'line_total')::numeric<>round((item->>'line_total')::numeric,2) then raise exception 'Importe o cantidad no válido';end if;
  sum_cents=sum_cents+(item->>'line_total')::numeric*100;
 end loop;
 for adj in select value from jsonb_array_elements(p_adjustments) loop
  if jsonb_typeof(adj)<>'object' or adj->>'kind' is null or adj->>'kind' not in ('discount','deposit','return','rounding','other') or adj->>'description' is null or length(btrim(adj->>'description')) not between 1 and 160 or adj->>'amount_cents' is null then raise exception 'Ajuste no válido';end if;
  if (adj->>'amount_cents')::numeric::text in ('NaN','Infinity','-Infinity') or abs((adj->>'amount_cents')::numeric)>999999999999 or (adj->>'amount_cents')::numeric<>trunc((adj->>'amount_cents')::numeric) then raise exception 'Ajuste no válido';end if;
  if adj->>'item_index' is not null and ((adj->>'item_index')::numeric<>trunc((adj->>'item_index')::numeric) or (adj->>'item_index')::numeric<0 or (adj->>'item_index')::numeric>=jsonb_array_length(p_items)) then raise exception 'Producto del ajuste no válido';end if;
  sum_cents=sum_cents+(adj->>'amount_cents')::numeric;
 end loop;
 if (jsonb_array_length(p_items)>0 or jsonb_array_length(p_adjustments)>0) and sum_cents<>p_total*100 then raise exception 'Productos y ajustes no coinciden con el total';end if;
 if p_receipt_id is not null then
  select * into r from public.purchase_receipts where id=p_receipt_id and household_id=p_household_id for update;
  if not found or r.status not in ('review','confirmed') or r.path is null or not exists(select 1 from storage.objects where bucket_id='receipts' and name=r.path) or (r.purchase_id is not null and r.purchase_id is distinct from p_purchase_id) then raise exception 'Recibo no disponible' using errcode='42501';end if;
 end if;
 if p_purchase_id is null then
  insert into public.purchases(household_id,created_by,store,purchased_on,total) values(p_household_id,u,btrim(p_store),p_date,p_total) returning id into v_id;
 else
  select * into p from public.purchases where id=p_purchase_id and household_id=p_household_id for update;
  if not found then raise exception 'Compra no disponible' using errcode='42501';end if;
  if p_expected_revision is null or p.revision<>p_expected_revision then raise exception 'La compra cambió. Vuelve a abrirla antes de editar.' using errcode='40001';end if;
  v_id=p_purchase_id;
  update public.purchases set store=btrim(p_store),purchased_on=p_date,total=p_total where id=v_id;
  delete from public.purchase_adjustments where purchase_id=v_id;
  delete from public.purchase_items where purchase_id=v_id;
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  insert into public.purchase_items(purchase_id,name,quantity,line_total) values(v_id,btrim(item->>'name'),(item->>'quantity')::numeric,(item->>'line_total')::numeric) returning id into iid;
  item_ids=array_append(item_ids,iid);
 end loop;
 for adj in select value from jsonb_array_elements(p_adjustments) loop
  idx=(adj->>'item_index')::integer;
  insert into public.purchase_adjustments(purchase_id,kind,description,amount_cents,item_id) values(v_id,adj->>'kind',btrim(adj->>'description'),(adj->>'amount_cents')::bigint,case when idx is null then null else item_ids[idx+1] end);
 end loop;
 if p_receipt_id is not null then update public.purchase_receipts set purchase_id=v_id,status='confirmed' where id=p_receipt_id;end if;
 select jsonb_build_object('purchase',to_jsonb(q),'items',coalesce((select jsonb_agg(i order by i.id) from public.purchase_items i where i.purchase_id=v_id),'[]'::jsonb),'adjustments',coalesce((select jsonb_agg(a order by a.id) from public.purchase_adjustments a where a.purchase_id=v_id),'[]'::jsonb)) into v_result from public.purchases q where q.id=v_id;
 if p_receipt_id is not null then v_result=v_result||jsonb_build_object('receipt',(select jsonb_build_object('id',id,'purchase_id',purchase_id,'path',path,'status',status) from public.purchase_receipts where id=p_receipt_id));end if;
 insert into public.purchase_operations(user_id,operation_id,household_id,payload,result) values(u,p_operation_id,p_household_id,v_payload,v_result);
 return v_result;
end $$;
-- Keep the manual contract, including pre-migration pending UUIDs. Old clients cannot erase adjustments.
create or replace function public.casa_save_purchase(p_operation_id uuid,p_household_id uuid,p_purchase_id uuid,p_expected_revision bigint,p_store text,p_date date,p_total numeric,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();v_payload jsonb;v_previous public.purchase_operations%rowtype;v_result jsonb;
begin
 if u is null or not exists(select 1 from public.household_members where household_id=p_household_id and user_id=u) then raise exception 'No perteneces al hogar' using errcode='42501';end if;
 if p_operation_id is null then raise exception 'Falta identificador';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||p_operation_id::text,0));
 v_payload=jsonb_build_object('household',p_household_id,'purchase',p_purchase_id,'revision',p_expected_revision,'store',p_store,'date',p_date,'total',p_total,'items',p_items);
 select * into v_previous from public.purchase_operations where user_id=u and operation_id=p_operation_id;
 if found then if v_previous.payload<>v_payload then raise exception 'La operación pendiente tiene datos diferentes';end if;return v_previous.result;end if;
 if exists(select 1 from public.purchase_adjustments where purchase_id=p_purchase_id) then raise exception 'Abre la edición de CASA 3.0 para conservar los ajustes';end if;
 v_result=public.casa_save_receipt(p_operation_id,p_household_id,p_purchase_id,p_expected_revision,p_store,p_date,p_total,p_items,'[]',null);
 update public.purchase_operations set payload=v_payload where user_id=u and operation_id=p_operation_id;
 return v_result;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('receipts','receipts',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict(id) do nothing;
do $$ begin if exists(select 1 from storage.buckets where id='receipts' and (public or file_size_limit is null or file_size_limit>10485760 or allowed_mime_types is null or not allowed_mime_types<@array['image/jpeg','image/png','image/webp','application/pdf'])) then raise exception 'El bucket receipts existente debe ser privado y tener límites MIME/10 MB compatibles';end if;end $$;
drop policy if exists casa_receipts_read on storage.objects;
create policy casa_receipts_read on storage.objects for select to authenticated using(bucket_id='receipts' and exists(select 1 from public.purchase_receipts r join public.household_members m on m.household_id=r.household_id where r.path=name and m.user_id=auth.uid()));
drop policy if exists casa_receipts_upload on storage.objects;
create policy casa_receipts_upload on storage.objects for insert to authenticated with check(bucket_id='receipts' and exists(select 1 from public.purchase_receipts r join public.household_members m on m.household_id=r.household_id where r.path=name and r.created_by=auth.uid() and r.status in ('upload_pending','error') and m.user_id=auth.uid()));
drop policy if exists casa_receipts_delete on storage.objects;
create policy casa_receipts_delete on storage.objects for delete to authenticated using(bucket_id='receipts' and exists(select 1 from public.purchase_receipts r join public.household_members m on m.household_id=r.household_id where r.path=name and r.status<>'processing' and m.user_id=auth.uid()));
-- No UPDATE policy: prevent replacing originals after extraction.
revoke all on function public.casa_receipt_claim(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.casa_receipt_claim(uuid,uuid,integer,integer) to service_role;
revoke all on function public.casa_receipt_begin(uuid,uuid,text,bigint),public.casa_receipt_cancel(uuid),public.casa_receipt_forget_file(uuid),public.casa_save_receipt(uuid,uuid,uuid,bigint,text,date,numeric,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.casa_receipt_begin(uuid,uuid,text,bigint),public.casa_receipt_cancel(uuid),public.casa_receipt_forget_file(uuid),public.casa_save_receipt(uuid,uuid,uuid,bigint,text,date,numeric,jsonb,jsonb,uuid) to authenticated;
commit;
