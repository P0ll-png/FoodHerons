-- FoodHerons — Phase A — 0005_rls.sql
-- Enable RLS on every public table and create every policy per design §2.
-- Run AFTER 0004_functions_triggers.sql (policies call public.auth_role()).
--
-- Legend from §2: every owner/role predicate is OR public.auth_role()='admin'.
-- orders/order_items have NO client INSERT/UPDATE (C# service-role only).
-- The C# service connects with the service-role connection, which bypasses
-- RLS entirely, so these policies only constrain the direct-from-browser path.

-- ===========================================================================
-- Enable RLS
-- ===========================================================================
alter table public.categories      enable row level security;
alter table public.location_areas  enable row level security;
alter table public.profiles        enable row level security;
alter table public.vendors         enable row level security;
alter table public.menu_items      enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.reviews         enable row level security;
alter table public.favorites       enable row level security;

-- ===========================================================================
-- categories — public SELECT; no client writes (seeded only).
-- ===========================================================================
drop policy if exists categories_select_all on public.categories;
create policy categories_select_all on public.categories
  for select using (true);

-- ===========================================================================
-- location_areas — public SELECT; no client writes (seeded only).
-- ===========================================================================
drop policy if exists location_areas_select_all on public.location_areas;
create policy location_areas_select_all on public.location_areas
  for select using (true);

-- ===========================================================================
-- profiles — own row only (no public read); admin may read/write any.
-- ===========================================================================
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select using (id = auth.uid() or public.auth_role() = 'admin');

-- Insert normally happens via the handle_new_user trigger (service definer).
-- Own-row insert is permitted (role never 'admin' — the signup trigger
-- coerces, and the role guard blocks self-promotion); admins may also insert.
drop policy if exists profiles_insert_own_or_admin on public.profiles;
create policy profiles_insert_own_or_admin on public.profiles
  for insert with check (id = auth.uid() or public.auth_role() = 'admin');

-- Update own row or admin; the guard_profile_role trigger blocks a non-admin
-- from changing role.
drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin on public.profiles
  for update using (id = auth.uid() or public.auth_role() = 'admin')
  with check (id = auth.uid() or public.auth_role() = 'admin');

drop policy if exists profiles_delete_own_or_admin on public.profiles;
create policy profiles_delete_own_or_admin on public.profiles
  for delete using (id = auth.uid() or public.auth_role() = 'admin');

-- ===========================================================================
-- vendors — public SELECT; INSERT admin-only; UPDATE owner or admin (column
-- guard restricts columns); DELETE admin-only. Ordinary vendor rows are
-- otherwise trigger-created.
-- ===========================================================================
drop policy if exists vendors_select_all on public.vendors;
create policy vendors_select_all on public.vendors
  for select using (true);

drop policy if exists vendors_insert_admin on public.vendors;
create policy vendors_insert_admin on public.vendors
  for insert with check (public.auth_role() = 'admin');

drop policy if exists vendors_update_owner_or_admin on public.vendors;
create policy vendors_update_owner_or_admin on public.vendors
  for update using (owner_id = auth.uid() or public.auth_role() = 'admin')
  with check (owner_id = auth.uid() or public.auth_role() = 'admin');

drop policy if exists vendors_delete_admin on public.vendors;
create policy vendors_delete_admin on public.vendors
  for delete using (public.auth_role() = 'admin');

-- ===========================================================================
-- menu_items — public SELECT; INSERT/UPDATE/DELETE by the vendor owner or admin.
-- ===========================================================================
drop policy if exists menu_items_select_all on public.menu_items;
create policy menu_items_select_all on public.menu_items
  for select using (true);

drop policy if exists menu_items_insert_owner_or_admin on public.menu_items;
create policy menu_items_insert_owner_or_admin on public.menu_items
  for insert with check (
    public.auth_role() = 'admin'
    or exists (select 1 from public.vendors v
                where v.id = menu_items.vendor_id and v.owner_id = auth.uid())
  );

drop policy if exists menu_items_update_owner_or_admin on public.menu_items;
create policy menu_items_update_owner_or_admin on public.menu_items
  for update using (
    public.auth_role() = 'admin'
    or exists (select 1 from public.vendors v
                where v.id = menu_items.vendor_id and v.owner_id = auth.uid())
  )
  with check (
    public.auth_role() = 'admin'
    or exists (select 1 from public.vendors v
                where v.id = menu_items.vendor_id and v.owner_id = auth.uid())
  );

drop policy if exists menu_items_delete_owner_or_admin on public.menu_items;
create policy menu_items_delete_owner_or_admin on public.menu_items
  for delete using (
    public.auth_role() = 'admin'
    or exists (select 1 from public.vendors v
                where v.id = menu_items.vendor_id and v.owner_id = auth.uid())
  );

-- ===========================================================================
-- orders — SELECT: student owns, vendor owns the vendor, or admin.
-- NO client INSERT/UPDATE (C# service-role only). No DELETE.
-- ===========================================================================
drop policy if exists orders_select_student_vendor_admin on public.orders;
create policy orders_select_student_vendor_admin on public.orders
  for select using (
    student_id = auth.uid()
    or exists (select 1 from public.vendors v
                where v.id = orders.vendor_id and v.owner_id = auth.uid())
    or public.auth_role() = 'admin'
  );

-- ===========================================================================
-- order_items — SELECT if the parent order is visible, or admin.
-- NO client INSERT/UPDATE (C# service-role only). No DELETE.
-- ===========================================================================
drop policy if exists order_items_select_visible_or_admin on public.order_items;
create policy order_items_select_visible_or_admin on public.order_items
  for select using (
    public.auth_role() = 'admin'
    or exists (
      select 1 from public.orders o
       where o.id = order_items.order_id
         and (
           o.student_id = auth.uid()
           or exists (select 1 from public.vendors v
                       where v.id = o.vendor_id and v.owner_id = auth.uid())
         )
    )
  );

-- ===========================================================================
-- reviews — public SELECT; INSERT by student on a completed, owned order;
-- UPDATE/DELETE by author or admin. Admins do not author reviews.
-- ===========================================================================
drop policy if exists reviews_select_all on public.reviews;
create policy reviews_select_all on public.reviews
  for select using (true);

drop policy if exists reviews_insert_student on public.reviews;
create policy reviews_insert_student on public.reviews
  for insert with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.orders o
       where o.id = reviews.order_id
         and o.student_id = auth.uid()
         and o.status = 'completed'
    )
  );

drop policy if exists reviews_update_author_or_admin on public.reviews;
create policy reviews_update_author_or_admin on public.reviews
  for update using (student_id = auth.uid() or public.auth_role() = 'admin')
  with check (student_id = auth.uid() or public.auth_role() = 'admin');

drop policy if exists reviews_delete_author_or_admin on public.reviews;
create policy reviews_delete_author_or_admin on public.reviews
  for delete using (student_id = auth.uid() or public.auth_role() = 'admin');

-- ===========================================================================
-- favorites — SELECT own or admin; INSERT own only; DELETE own or admin.
-- NO UPDATE policy for anyone (the membership tuple has nothing mutable).
-- ===========================================================================
drop policy if exists favorites_select_own_or_admin on public.favorites;
create policy favorites_select_own_or_admin on public.favorites
  for select using (student_id = auth.uid() or public.auth_role() = 'admin');

drop policy if exists favorites_insert_own on public.favorites;
create policy favorites_insert_own on public.favorites
  for insert with check (student_id = auth.uid());

drop policy if exists favorites_delete_own_or_admin on public.favorites;
create policy favorites_delete_own_or_admin on public.favorites
  for delete using (student_id = auth.uid() or public.auth_role() = 'admin');
