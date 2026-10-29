-- FoodHerons — Phase B — 0008_vendor_approval.sql
-- Admin store approval + GCash receiving-account columns, per the
-- admin-revenue-gcash design (Part 2). Run AFTER 0007_order_rpcs.sql.
--
-- Contents:
--   vendor_approval_status enum (closed domain, idempotent like 0002)
--   vendors.approval_status (NOT NULL DEFAULT 'pending', existing rows backfilled)
--   vendors_approval_status_idx
--   vendors.gcash_number / vendors.gcash_name (nullable receiving-account fields)
--   guard_vendor_columns() re-declared with an admin-only approval_status branch
--   vendors SELECT policy narrowed: students see only 'approved' stores
--
-- New vendor signups created after this migration default to 'pending' (the
-- column DEFAULT). Existing/demo stores predate approval and are backfilled to
-- 'approved' so the running app is not retroactively hidden.

-- ===========================================================================
-- Enum: closed domain for approval state. Same idempotency block as 0002.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'vendor_approval_status') then
    create type public.vendor_approval_status as enum (
      'pending', 'approved', 'rejected', 'suspended'
    );
  end if;
end$$;

-- ===========================================================================
-- Columns: approval_status (defaulted + backfilled) + GCash receiving account.
-- ===========================================================================
alter table public.vendors
  add column if not exists approval_status public.vendor_approval_status
    not null default 'pending';

-- One-time backfill: every row that predates this migration becomes approved.
-- New signups created after this migration get the 'pending' default.
update public.vendors set approval_status = 'approved'
  where approval_status = 'pending';

create index if not exists vendors_approval_status_idx
  on public.vendors (approval_status);

-- GCash receiving-account fields (nullable; no default). A vendor must set a
-- gcash_number before pre-ordering can be enabled (gated in the UI).
alter table public.vendors
  add column if not exists gcash_number text,
  add column if not exists gcash_name   text;

-- ===========================================================================
-- guard_vendor_columns(): re-declared from 0004 with the whole body preserved
-- plus a new branch — approval_status may only be changed by an admin. Keeps
-- the service-role early return, the foodherons.rating_sync flag, the
-- rating/review_count guard, and the owner_id guard intact.
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

  -- approval_status may change only for an admin caller. The owner RLS UPDATE
  -- branch lets a vendor edit their own row, so this guard is what stops a
  -- vendor from self-approving.
  if new.approval_status is distinct from old.approval_status
     and public.auth_role() <> 'admin' then
    raise exception 'approval_status can only be changed by an admin';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_vendor_columns on public.vendors;
create trigger guard_vendor_columns
  before update on public.vendors
  for each row execute function public.guard_vendor_columns();

-- ===========================================================================
-- RLS read narrowing: replace the open vendors_select_all (using (true)) so
-- students/anon see only approved stores, while owners see their own row and
-- admins see every row. anon has a null auth.uid(), so anon sees only approved.
-- ===========================================================================
drop policy if exists vendors_select_all on public.vendors;
create policy vendors_select_approved_or_privileged on public.vendors
  for select using (
    approval_status = 'approved'
    or owner_id = auth.uid()
    or public.auth_role() = 'admin'
  );
