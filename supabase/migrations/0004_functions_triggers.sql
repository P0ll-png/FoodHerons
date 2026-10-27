-- FoodHerons — Phase A — 0004_functions_triggers.sql
-- Helper function + all triggers, per design §2/§3.
-- Run AFTER 0003_tables.sql (functions reference existing columns).
--
-- Contents:
--   public.auth_role()            — SECURITY DEFINER STABLE role lookup (no RLS recursion)
--   public.handle_new_user()      — signup trigger on auth.users (admin-coercion, vendor provision)
--   public.guard_vendor_columns() — BEFORE UPDATE column guard on vendors
--   public.guard_profile_role()   — BEFORE UPDATE role-immutability guard on profiles
--   public.set_review_snapshot()  — BEFORE INSERT snapshot of author_name/ordered_summary
--   public.sync_vendor_rating()   — reviews -> vendors.rating/review_count aggregate

-- ===========================================================================
-- auth_role(): caller's profiles.role. SECURITY DEFINER so its internal SELECT
-- does not re-enter RLS (safe to call from inside profiles policies).
-- NOT named current_role (reserved Postgres built-in).
-- ===========================================================================
create or replace function public.auth_role()
  returns public.user_role
  language sql
  security definer
  stable
  set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ===========================================================================
-- handle_new_user(): fires AFTER INSERT on auth.users. Provisions the profile
-- and, for vendors, the owned vendors row.
-- ===========================================================================
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role        public.user_role;
  v_full_name   text;
  v_mobile      text;
  v_store_name  text;
  v_store_slug  text;
  v_is_service  boolean;
  v_slug        text;
  v_base_slug   text;
  v_suffix      integer;
begin
  -- Coerce any role not exactly 'vendor' to 'student' so 'admin' (or any
  -- unknown string) can never be obtained via signup.
  v_role := case
    when new.raw_user_meta_data->>'role' = 'vendor' then 'vendor'::public.user_role
    else 'student'::public.user_role
  end;

  v_full_name  := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_mobile     := new.raw_user_meta_data->>'mobile';
  v_store_name := new.raw_user_meta_data->>'store_name';
  v_store_slug := new.raw_user_meta_data->>'store_slug';

  -- Service/seed connection iff there is no PostgREST/GoTrue JWT context.
  v_is_service := current_setting('request.jwt.claims', true) is null;

  -- Provision the profile row.
  insert into public.profiles (id, role, full_name, email, mobile)
  values (new.id, v_role, v_full_name, new.email, v_mobile);

  -- Mirror role into app_metadata (not user-writable) so the C# service can
  -- read role from the JWT without a DB round-trip.
  update auth.users
    set raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role::text)
    where id = new.id;

  -- Vendors get an owned store row created here (sole writer of that row).
  if v_role = 'vendor' then
    if v_is_service then
      -- Service/seed path: honor the supplied store_slug verbatim and use
      -- ON CONFLICT (id) DO NOTHING so re-seeding is idempotent.
      v_slug := coalesce(nullif(v_store_slug, ''), 'vendor-' || replace(new.id::text, '-', ''));
      insert into public.vendors (id, owner_id, name)
      values (v_slug, new.id, coalesce(v_store_name, 'Unnamed Store'))
      on conflict (id) do nothing;
    else
      -- Browser self-signup: ignore store_slug entirely. Slugify store_name
      -- and append a numeric suffix on collision so the id is always unique.
      v_base_slug := trim(both '-' from
        lower(regexp_replace(coalesce(v_store_name, 'store'), '[^a-z0-9]+', '-', 'gi')));
      if v_base_slug = '' then
        v_base_slug := 'store';
      end if;
      v_slug := v_base_slug;
      v_suffix := 1;
      while exists (select 1 from public.vendors where id = v_slug) loop
        v_suffix := v_suffix + 1;
        v_slug := v_base_slug || '-' || v_suffix::text;
      end loop;
      -- Plain conflict-surfacing INSERT (no DO NOTHING): the generated slug is
      -- unique, so a self-signup vendor always gets exactly one store row.
      insert into public.vendors (id, owner_id, name)
      values (v_slug, new.id, coalesce(v_store_name, 'Unnamed Store'));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- guard_vendor_columns(): BEFORE UPDATE on vendors. Rejects client changes to
-- owner_id/rating/review_count. Service-role early-return first; admins may
-- change owner_id; nobody (client) may write rating/review_count.
-- ===========================================================================
create or replace function public.guard_vendor_columns()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- Service-role / direct-DB / seed connection: unguarded. AUTHORITATIVE test
  -- is request.jwt.claims IS NULL; the current_user list is belt-and-suspenders.
  if current_setting('request.jwt.claims', true) is null
     or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  -- Internal aggregate-maintenance path: sync_vendor_rating() sets this
  -- session-local flag before updating rating/review_count, so its own
  -- UPDATE (which may run inside a JWT-bearing request that just inserted a
  -- review) is allowed through this guard. The flag is set only by that
  -- SECURITY DEFINER function and cleared immediately after.
  if current_setting('foodherons.rating_sync', true) = 'on' then
    return new;
  end if;

  -- Denormalized aggregates are trigger-maintained; no client (admin included)
  -- may hand-edit them.
  if new.rating is distinct from old.rating
     or new.review_count is distinct from old.review_count then
    raise exception 'rating/review_count are maintained by the system and cannot be set directly';
  end if;

  -- owner_id may change only for an admin caller (the assign/claim tool).
  if new.owner_id is distinct from old.owner_id
     and public.auth_role() <> 'admin' then
    raise exception 'owner_id can only be changed by an admin';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_vendor_columns on public.vendors;
create trigger guard_vendor_columns
  before update on public.vendors
  for each row execute function public.guard_vendor_columns();

-- ===========================================================================
-- guard_profile_role(): BEFORE UPDATE on profiles. Blocks a user from changing
-- their own role; an admin may change another user's role. Same service early-return.
-- ===========================================================================
create or replace function public.guard_profile_role()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if current_setting('request.jwt.claims', true) is null
     or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.role is distinct from old.role
     and public.auth_role() <> 'admin' then
    raise exception 'role can only be changed by an admin';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_role on public.profiles;
create trigger guard_profile_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ===========================================================================
-- set_review_snapshot(): BEFORE INSERT on reviews. Fills author_name from
-- profiles and ordered_summary from order_items (SECURITY DEFINER bypasses
-- those tables' SELECT policies for the caller's own order).
-- ===========================================================================
create or replace function public.set_review_snapshot()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  new.author_name := coalesce(
    (select full_name from public.profiles where id = auth.uid()),
    ''
  );
  new.ordered_summary := coalesce(
    (select string_agg(qty || '× ' || name, ', ')
       from public.order_items
      where order_id = new.order_id),
    ''
  );
  return new;
end;
$$;

drop trigger if exists set_review_snapshot on public.reviews;
create trigger set_review_snapshot
  before insert on public.reviews
  for each row execute function public.set_review_snapshot();

-- ===========================================================================
-- sync_vendor_rating(): AFTER INSERT/DELETE on reviews. Recomputes the
-- denormalized vendors.rating/review_count from the reviews table.
-- ===========================================================================
create or replace function public.sync_vendor_rating()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_vendor_id text;
begin
  v_vendor_id := coalesce(new.vendor_id, old.vendor_id);

  -- Signal guard_vendor_columns() that this is the legitimate internal
  -- aggregate-maintenance write (set_config local = transaction-scoped).
  perform set_config('foodherons.rating_sync', 'on', true);

  update public.vendors v
     set rating = coalesce((
           select round(avg(r.rating)::numeric, 1)
             from public.reviews r
            where r.vendor_id = v_vendor_id
         ), 0),
         review_count = (
           select count(*)
             from public.reviews r
            where r.vendor_id = v_vendor_id
         )
   where v.id = v_vendor_id;

  perform set_config('foodherons.rating_sync', 'off', true);

  return null;
end;
$$;

drop trigger if exists sync_vendor_rating_ins on public.reviews;
create trigger sync_vendor_rating_ins
  after insert on public.reviews
  for each row execute function public.sync_vendor_rating();

drop trigger if exists sync_vendor_rating_del on public.reviews;
create trigger sync_vendor_rating_del
  after delete on public.reviews
  for each row execute function public.sync_vendor_rating();
