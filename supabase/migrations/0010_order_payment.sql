-- FoodHerons — Phase B — 0010_order_payment.sql
-- GCash-gated pre-orders: payment columns, the awaiting_payment default, the
-- private payment-proofs Storage bucket + policies, the submit_payment RPC,
-- and the 4-arg transition_order overload, per the admin-revenue-gcash design
-- (§4.3). Run AFTER 0009_order_payment_enum.sql (which must be its OWN
-- SQL-editor execution so the new enum labels are committed first).
--
-- External dependency: this migration writes to storage.buckets /
-- storage.objects, which exist on a HOSTED Supabase project (not bare
-- Postgres). See supabase/README.md.

-- ===========================================================================
-- 1. Payment columns on orders + awaiting_payment default.
-- ===========================================================================
alter table public.orders
  add column if not exists payment_method text not null default 'gcash',
  add column if not exists gcash_reference text,
  add column if not exists payment_screenshot_path text,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_verified_by uuid references public.profiles(id),
  add column if not exists payment_rejected_reason text,
  add column if not exists payment_submitted_at timestamptz;

-- New orders start awaiting_payment (place_order omits status, relying on the
-- column default). Existing in-flight orders keep their current status.
alter table public.orders alter column status set default 'awaiting_payment';

-- ===========================================================================
-- 2. Private payment-proofs Storage bucket + RLS policies.
--    Object path convention: <order_id>/<filename>.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

-- INSERT (upload): only the authenticated student who owns the order named in
-- the first path segment may upload under that prefix.
drop policy if exists payment_proofs_insert_owner on storage.objects;
create policy payment_proofs_insert_owner on storage.objects
  for insert to authenticated with check (
    bucket_id = 'payment-proofs'
    and exists (
      select 1 from public.orders o
       where o.id = (split_part(name, '/', 1))::uuid
         and o.student_id = auth.uid()
    )
  );

-- SELECT (read, for signed URLs): exactly three authorized reader classes —
-- the owning student, the vendor owner of the order, or an admin. The
-- vendor-owner branch is constrained through the order's own vendor_id, so no
-- vendor can sign a URL for another vendor's order screenshot.
drop policy if exists payment_proofs_select_visible on storage.objects;
create policy payment_proofs_select_visible on storage.objects
  for select to authenticated using (
    bucket_id = 'payment-proofs'
    and exists (
      select 1 from public.orders o
       where o.id = (split_part(name, '/', 1))::uuid
         and (
           o.student_id = auth.uid()
           or exists (
             select 1 from public.vendors v
              where v.id = o.vendor_id and v.owner_id = auth.uid()
           )
           or public.auth_role() = 'admin'
         )
    )
  );

-- No UPDATE/DELETE policies — proofs are immutable once uploaded.

-- ===========================================================================
-- 3. submit_payment(): student payment submission (SECURITY DEFINER, called by
--    the C# service with the service-role key). Locks the order, requires it to
--    be awaiting_payment, stamps the reference/screenshot/submitted-at, and
--    moves it to payment_submitted. Mirrors transition_order's FH001/FH002.
-- ===========================================================================
create or replace function public.submit_payment(
  p_id              uuid,
  p_reference       text,
  p_screenshot_path text
)
  returns public.orders
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_from  text;
  v_order public.orders;
begin
  -- Lock the row and read its current status (lost-race tie-break).
  select status::text into v_from
  from public.orders
  where id = p_id
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'FH002';
  end if;

  if v_from <> 'awaiting_payment' then
    raise exception 'order % is not awaiting payment (status %)', p_id, v_from using errcode = 'FH001';
  end if;

  update public.orders
     set gcash_reference         = p_reference,
         payment_screenshot_path = p_screenshot_path,
         payment_submitted_at    = now(),
         status                  = 'payment_submitted'
   where id = p_id
  returning * into v_order;

  return v_order;
end;
$$;

-- Lock down execute, same guarded pattern as place_order (0007 Finding 7).
revoke all on function public.submit_payment(uuid, text, text) from public;
do $$
begin
  if exists (select from pg_roles where rolname in ('anon', 'authenticated')) then
    revoke all on function public.submit_payment(uuid, text, text) from anon, authenticated;
  end if;
end
$$;

-- ===========================================================================
-- 4. transition_order(): new 4-arg overload (p_actor LAST) with the 4 new
--    whitelist pairs + payment stamping. The old 3-arg overload is DROPPED so
--    nothing is left with default PUBLIC/anon/authenticated EXECUTE, and the
--    new signature gets the guarded REVOKEs. The legal (from,to) set is a
--    MIRROR of OrderService.Legal (now 9 pairs), kept in sync by a C# test.
-- ===========================================================================
create or replace function public.transition_order(
  p_id     uuid,
  p_to     text,
  p_reason text,
  p_actor  uuid
)
  returns public.orders
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_from  text;
  v_order public.orders;
  v_legal boolean;
begin
  -- Lock the row and read its current status (lost-race tie-break).
  select status::text into v_from
  from public.orders
  where id = p_id
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'FH002';
  end if;

  -- Minimal mirror of OrderService.Legal (9 pairs). Kept in sync by a C# test.
  v_legal := (v_from, p_to) in (
    ('pending',           'preparing'),
    ('preparing',         'ready'),
    ('ready',             'completed'),
    ('pending',           'cancelled'),
    ('preparing',         'cancelled'),
    ('payment_submitted', 'pending'),
    ('payment_submitted', 'awaiting_payment'),
    ('awaiting_payment',  'cancelled'),
    ('payment_submitted', 'cancelled')
  );

  if not v_legal then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'FH001';
  end if;

  update public.orders
     set status       = p_to::public.order_status,
         accepted_at  = case when p_to = 'preparing'  then now() else accepted_at  end,
         ready_at     = case when p_to = 'ready'      then now() else ready_at     end,
         completed_at = case when p_to = 'completed'  then now() else completed_at end,
         cancelled_at = case when p_to = 'cancelled'  then now() else cancelled_at end,
         cancel_reason = case when p_to = 'cancelled' then p_reason else cancel_reason end,
         -- Payment verification stamps on ->pending; rejection reason on ->awaiting_payment.
         payment_verified_at = case when p_to = 'pending' then now() else payment_verified_at end,
         payment_verified_by = case when p_to = 'pending' then p_actor else payment_verified_by end,
         payment_rejected_reason = case when p_to = 'awaiting_payment' then p_reason else payment_rejected_reason end
   where id = p_id
  returning * into v_order;

  return v_order;
end;
$$;

-- Drop the stale 3-arg overload (nothing calls it any more — the C# layer moves
-- to the 4-arg body) and lock down the new 4-arg signature (0007 pattern).
drop function if exists public.transition_order(uuid, text, text);
revoke all on function public.transition_order(uuid, text, text, uuid) from public;
do $$
begin
  if exists (select from pg_roles where rolname in ('anon', 'authenticated')) then
    revoke all on function public.transition_order(uuid, text, text, uuid) from anon, authenticated;
  end if;
end
$$;
