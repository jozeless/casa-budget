-- CASA 3.2. Apply manually after the Phase 2 and CASA 3.0 migrations and a verified backup.
-- Replaces function bodies only: no table/policy changes, historical DML or operation payload changes.
-- Same signatures, owner and existing grants are preserved by CREATE OR REPLACE.
begin;
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
 -- p_total is the confirmed paid amount. Do not synthesize or require balancing adjustments.
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
declare u uuid:=auth.uid();v_payload jsonb;v_previous public.purchase_operations%rowtype;v_result jsonb;v_sum numeric;
begin
 if u is null or not exists(select 1 from public.household_members where household_id=p_household_id and user_id=u) then raise exception 'No perteneces al hogar' using errcode='42501';end if;
 if p_operation_id is null then raise exception 'Falta identificador';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||p_operation_id::text,0));
 v_payload=jsonb_build_object('household',p_household_id,'purchase',p_purchase_id,'revision',p_expected_revision,'store',p_store,'date',p_date,'total',p_total,'items',p_items);
 select * into v_previous from public.purchase_operations where user_id=u and operation_id=p_operation_id;
 if found then if v_previous.payload<>v_payload then raise exception 'La operación pendiente tiene datos diferentes';end if;return v_previous.result;end if;
 if exists(select 1 from public.purchase_adjustments where purchase_id=p_purchase_id) then raise exception 'Abre la edición de CASA 3.0 para conservar los ajustes';end if;
 -- Manual purchases keep their existing equality contract. Completed UUIDs replay above.
 -- The delegated function still performs every individual validation and atomic write.
 if jsonb_typeof(p_items)='array' then
  if jsonb_array_length(p_items) between 1 and 500 then
   select sum((item->>'line_total')::numeric) into v_sum from jsonb_array_elements(p_items) as lines(item);
   if v_sum<>p_total then raise exception 'La suma de productos no coincide con el total';end if;
  end if;
 end if;
 v_result=public.casa_save_receipt(p_operation_id,p_household_id,p_purchase_id,p_expected_revision,p_store,p_date,p_total,p_items,'[]',null);
 update public.purchase_operations set payload=v_payload where user_id=u and operation_id=p_operation_id;
 return v_result;
end $$;
commit;
