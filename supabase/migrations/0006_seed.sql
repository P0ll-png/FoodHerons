-- FoodHerons — Phase A — 0006_seed.sql
-- Seed only the data pure SQL can insert, per design §5.
-- Run AFTER 0005_rls.sql.
--
-- Seeds: 6 categories (+ 'uncategorized' safe-default) and 6 location_areas
-- (+ 'unassigned' safe-default). The 'uncategorized'/'unassigned' rows exist
-- so the handle_new_user trigger's minimal vendor INSERT satisfies its FKs.
--
-- The 8 vendors + their menu_items are NOT inserted here: they are created by
-- the signup trigger when the demo auth users are made (service connection)
-- and then UPDATEd with real values by scripts/seed-demo.mjs, because creating
-- auth users requires the Admin API (service-role), which cannot be done from
-- the dashboard SQL editor.
--
-- Idempotent: ON CONFLICT DO UPDATE keeps re-runs safe and converging.

-- ---------------------------------------------------------------------------
-- categories — 6 real rows from src/data/vendors.js, plus 'uncategorized'.
-- ---------------------------------------------------------------------------
insert into public.categories (id, name, image, sort_order) values
  ('rice',          'Rice Meals',   '/images/ricemeals.png', 1),
  ('snacks',        'Snacks',       '/images/snacks.png',    2),
  ('drinks',        'Drinks',       '/images/drinks.png',    3),
  ('desserts',      'Desserts',     '/images/desserts.png',  4),
  ('noodles',       'Noodles',      '/images/noodles.png',   5),
  ('grill',         'Grill & BBQ',  '/images/grill.png',     6),
  ('uncategorized', 'Uncategorized', null,                   99)
on conflict (id) do update
  set name       = excluded.name,
      image      = excluded.image,
      sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- location_areas — 6 real values from src/data/vendors.js (id = name = value),
-- plus 'unassigned'.
-- ---------------------------------------------------------------------------
insert into public.location_areas (id, name, sort_order) values
  ('Main Gate',     'Main Gate',     1),
  ('HPSB Building', 'HPSB Building', 2),
  ('Admin Lobby',   'Admin Lobby',   3),
  ('Covered Court', 'Covered Court', 4),
  ('Food Court',    'Food Court',    5),
  ('Back Gate',     'Back Gate',     6),
  ('unassigned',    'Unassigned',    99)
on conflict (id) do update
  set name       = excluded.name,
      sort_order = excluded.sort_order;
