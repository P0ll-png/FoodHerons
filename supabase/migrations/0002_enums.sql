-- FoodHerons — Phase A — 0002_enums.sql
-- The only two Postgres enums (true closed domains, per design §1).
-- Run AFTER 0001_extensions.sql.
--
-- user_role gains the third value 'admin' (Change 1). 'admin' is never
-- written by the signup trigger from client metadata (see 0004 handle_new_user
-- coercion guard) and is only set manually on a profiles row.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('student', 'vendor', 'admin');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum (
      'pending', 'preparing', 'ready', 'completed', 'cancelled'
    );
  end if;
end$$;
