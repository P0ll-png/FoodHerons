-- FoodHerons — Phase B — 0007_order_rpcs.sql
-- RPC functions backing the HTTPS (PostgREST) order service, per the
-- order-https-rearchitecture design. Run AFTER 0006_seed.sql.
--
-- Both functions are SECURITY DEFINER and intended to be called by the C#
-- service with the service-role key over POST /rest/v1/rpc/<fn>. They
-- encapsulate the two multi-statement writes that cannot be done atomically
-- across separate PostgREST calls:
--   place_order       — insert orders + order_items in one transaction
--   transition_order  — locked read + guarded status/timestamp update
--
-- Transition-planning AUTHORITY lives in C# OrderService. The whitelist here
-- is a deliberate minimal mirror of OrderService.Legal, guarding the atomic
-- write only. A C# test asserts the two sets stay in sync.

-- ===========================================================================
-- place_order(): atomic order + items insert. DB assigns code + placed_at.
-- Returns the new orders row (RETURNS orders -> PostgREST sends it back).
-- ===========================================================================
create or replace function public.place_order(
  p_student  uuid,
  p_vendor   text,
  p_subtotal numeric,
  p_total    numeric,
  p_pickup   text,
  p_note     text,
  p_items    jsonb
)
  returns public.orders
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_order public.orders;
begin
  insert into public.orders (student_id, vendor_id, subtotal, total, pickup_name, note)
  values (p_student, p_vendor, p_subtotal, p_total, p_pickup, p_note)
  returning * into v_order;

  insert into public.order_items (order_id, menu_item_id, vendor_id, name, unit_price, qty)
  select
    v_order.id,
    elem->>'menu_item_id',
    elem->>'vendor_id',
    elem->>'name',
    (elem->>'unit_price')::numeric,
    (elem->>'qty')::integer
  from jsonb_array_elements(p_items) as elem;

  return v_order;
end;
$$;

-- Lock down execute. revoke from public always applies; the anon/authenticated
-- revokes are guarded so this migration also runs on a bare Postgres that lacks
-- the Supabase roles (Finding 7).
revoke all on function public.place_order(uuid, text, numeric, numeric, text, text, jsonb) from public;
do $$
begin
  if exists (select from pg_roles where rolname in ('anon', 'authenticated')) then
    revoke all on function public.place_order(uuid, text, numeric, numeric, text, text, jsonb) from anon, authenticated;
  end if;
end
$$;

-- ===========================================================================
-- transition_order(): locked read + guarded status/timestamp update.
-- Returns the updated orders row on success. Raises a typed exception with
-- SQLSTATE 'FH001' (illegal transition) or 'FH002' (not found) that the C#
-- layer maps to ILLEGAL_TRANSITION / NOT_FOUND. The legal (from,to) set below
-- is a MIRROR of OrderService.Legal.
-- ===========================================================================
create or replace function public.transition_order(
  p_id     uuid,
  p_to     text,
  p_reason text
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

  -- Minimal mirror of OrderService.Legal (5 pairs). Kept in sync by a C# test.
  v_legal := (v_from, p_to) in (
    ('pending',   'preparing'),
    ('preparing', 'ready'),
    ('ready',     'completed'),
    ('pending',   'cancelled'),
    ('preparing', 'cancelled')
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
         cancel_reason = case when p_to = 'cancelled' then p_reason else cancel_reason end
   where id = p_id
  returning * into v_order;

  return v_order;
end;
$$;

-- Same guarded lockdown as place_order (Finding 7).
revoke all on function public.transition_order(uuid, text, text) from public;
do $$
begin
  if exists (select from pg_roles where rolname in ('anon', 'authenticated')) then
    revoke all on function public.transition_order(uuid, text, text) from anon, authenticated;
  end if;
end
$$;
