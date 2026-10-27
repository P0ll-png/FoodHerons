-- FoodHerons — Phase A — 0001_extensions.sql
-- Extensions required by later migrations.
-- Run FIRST in the Supabase dashboard SQL editor.
--
-- pgcrypto provides gen_random_uuid(), used as the PK default on
-- orders / order_items / reviews. On Supabase Postgres gen_random_uuid()
-- is generally available via core/pgcrypto, but we create the extension
-- explicitly so these migrations are self-contained and idempotent.

create extension if not exists pgcrypto;
