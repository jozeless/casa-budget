-- CASA · Ejecutar una sola vez en Supabase > SQL Editor.
-- Cada usuario pertenece como máximo a un hogar en esta primera versión.
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  monthly_budget numeric(12,2) not null default 0 check (monthly_budget >= 0),
  invite_code uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  store text not null check (char_length(trim(store)) between 1 and 80),
  purchased_on date not null,
  total numeric(12,2) not null check (total > 0),
  created_at timestamptz not null default now()
);
create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  quantity numeric(9,2) not null default 1 check (quantity > 0),
  line_total numeric(12,2) not null check (line_total >= 0)
);
create index if not exists purchases_household_date_idx on public.purchases(household_id,purchased_on desc);
create index if not exists purchase_items_purchase_idx on public.purchase_items(purchase_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;

-- Solo miembros del hogar pueden leer/actualizar información del hogar.
create policy "households_members_select" on public.households for select to authenticated
using (exists (select 1 from public.household_members m where m.household_id=id and m.user_id=(select auth.uid())));
create policy "households_members_update" on public.households for update to authenticated
using (exists (select 1 from public.household_members m where m.household_id=id and m.user_id=(select auth.uid())))
with check (exists (select 1 from public.household_members m where m.household_id=id and m.user_id=(select auth.uid())));
create policy "members_own_select" on public.household_members for select to authenticated
using (user_id=(select auth.uid()));
create policy "purchases_members_select" on public.purchases for select to authenticated
using (exists (select 1 from public.household_members m where m.household_id=purchases.household_id and m.user_id=(select auth.uid())));
create policy "purchases_members_insert" on public.purchases for insert to authenticated
with check (created_by=(select auth.uid()) and exists (select 1 from public.household_members m where m.household_id=purchases.household_id and m.user_id=(select auth.uid())));
create policy "purchases_members_delete" on public.purchases for delete to authenticated
using (exists (select 1 from public.household_members m where m.household_id=purchases.household_id and m.user_id=(select auth.uid())));
create policy "items_members_select" on public.purchase_items for select to authenticated
using (exists (select 1 from public.purchases p join public.household_members m on m.household_id=p.household_id where p.id=purchase_items.purchase_id and m.user_id=(select auth.uid())));
create policy "items_members_insert" on public.purchase_items for insert to authenticated
with check (exists (select 1 from public.purchases p join public.household_members m on m.household_id=p.household_id where p.id=purchase_items.purchase_id and m.user_id=(select auth.uid())));

-- Función segura para crear hogar y asociar a su creador en una misma transacción.
create or replace function public.create_my_household(p_name text, p_budget numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if exists (select 1 from public.household_members where user_id=auth.uid()) then raise exception 'Ya perteneces a un hogar'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 60 or p_budget is null or p_budget < 0 or p_budget > 99999999 then raise exception 'Datos del hogar no válidos'; end if;
  insert into public.households(name, monthly_budget) values(trim(p_name), round(p_budget,2)) returning id into v_id;
  insert into public.household_members(household_id,user_id) values(v_id,auth.uid());
  return v_id;
end $$;

-- Solo una persona con código privado puede asociar su cuenta al hogar.
create or replace function public.join_my_household(p_invite_code uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if exists (select 1 from public.household_members where user_id=auth.uid()) then raise exception 'Ya perteneces a un hogar'; end if;
  select id into v_id from public.households where invite_code=p_invite_code;
  if v_id is null then raise exception 'Código de invitación inválido'; end if;
  insert into public.household_members(household_id,user_id) values(v_id,auth.uid());
  return v_id;
end $$;

revoke all on function public.create_my_household(text,numeric) from public;
revoke all on function public.join_my_household(uuid) from public;
grant execute on function public.create_my_household(text,numeric) to authenticated;
grant execute on function public.join_my_household(uuid) to authenticated;
-- No hay políticas de INSERT directas en households/household_members;
-- el alta de miembros ocurre exclusivamente mediante las funciones anteriores.
