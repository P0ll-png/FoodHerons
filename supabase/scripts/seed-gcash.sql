-- FoodHerons — dev/demo seed: sample GCash details for every store.
--
-- Fills public.vendors.gcash_number and gcash_name (added in
-- 0008_vendor_approval.sql) so the GCash-gated pre-order flow can be exercised
-- end to end. These are FAKE sample numbers for local/demo use only — they are
-- not real GCash accounts and must not be shipped to production.
--
-- Run AFTER 0008_vendor_approval.sql, in the Supabase SQL editor or psql.
-- Idempotent: safe to re-run. By default it only fills stores that don't yet
-- have a gcash_number (so hand-entered real values are preserved). To force a
-- reset of every store to the generated sample, see the note at the bottom.
--
-- Number format: Philippine mobile '09XXXXXXXXX' (11 digits), which is what
-- GCash accounts use. Each store gets a DISTINCT number deterministically
-- derived from its primary key, so re-runs and fresh DBs produce stable values.

update public.vendors v
set
  -- '0917' prefix + 7 digits derived from a stable hash of the vendor id.
  -- abs(hashtext(id)) % 10000000 gives 0..9,999,999; lpad to 7 digits.
  gcash_number = '0917' || lpad((abs(hashtext(v.id)) % 10000000)::text, 7, '0'),
  -- Payee name shown to customers: the store name, trimmed to GCash's ~60-char
  -- display limit, with a sensible fallback.
  gcash_name   = left(coalesce(nullif(trim(v.name), ''), 'FoodHerons Store'), 60),
  updated_at   = now()
where v.gcash_number is null;   -- only fill stores that have no number yet

-- Report what every store now has (handy in the SQL editor).
select id, name, gcash_name, gcash_number
from public.vendors
order by name;

-- ---------------------------------------------------------------------------
-- FORCE-RESET VARIANT (optional):
-- To overwrite EVERY store with the generated sample (ignoring existing
-- values), drop the WHERE clause above, i.e. change:
--     where v.gcash_number is null;
-- to:
--     where true;
-- ---------------------------------------------------------------------------
