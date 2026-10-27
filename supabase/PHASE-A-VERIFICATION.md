# Phase A — Verification

Phase A is SQL + a Node seed script. There is no running app and no DB
connection in the build environment, so nothing here was executed against a
live database. This file summarizes what was statically verified and the manual
dashboard steps you must run to fully verify (§7 of the design).

## Statically verified (no DB required)

- **Schema** — every table, column, type, constraint, PK/FK, and index in
  `migrations/0003_tables.sql` matches design §1 (money `numeric(10,2)`;
  `menu_items` composite PK `(vendor_id, id)`; `order_items` has no FK to
  `menu_items`; `reviews.order_id NOT NULL` + `(student_id,vendor_id,order_id)`
  unique; `author_name`/`ordered_summary` NOT NULL; `uncategorized`/`unassigned`
  and `'00:00'` defaults; `DEFAULT auth.uid()` on review/favorite student_id).
- **Functions/triggers** — `auth_role()`, `handle_new_user` (admin coercion +
  caller-based vendor slug branch), the vendors/profiles column guards (service
  early-return + admin exemption), `set_review_snapshot`, and the reviews→vendor
  rating aggregate all match design §2/§3.
- **RLS** — RLS enabled on all 9 tables; every §2 policy present (orders /
  order_items have no client INSERT/UPDATE; favorites has no UPDATE; admin
  predicates/policies per the §2 table).
- **Ordering** — statements apply cleanly top-to-bottom: extensions → enums →
  tables (+ sequence) → functions/triggers → RLS → seed; referenced objects
  always exist before use.
- **Seed data** — all 8 vendors and every menu item from `src/data/vendors.js`
  are present in `scripts/seed-demo.mjs` with correct prices/flags; demo store
  names match the §5 table (incl. "Ate Len Noodle House", "The Sweet Spot",
  "Kuya Boy Smoky Grill").
- **Script parse** — `node --check scripts/seed-demo.mjs` passes (not executed).

Full evidence: `.agents/tasks/supabase-backend/verification-note.md`.

## Manual steps to fully verify (run in the dashboard)

1. Apply `migrations/0001`–`0006` in order in the SQL editor — no errors.
2. Install `@supabase/supabase-js`, set env, run `node scripts/seed-demo.mjs`.
3. Anon `select` returns the 8 vendors + their menu items.
4. Student JWT cannot insert into `orders`, cannot update another vendor's
   `menu_items`.
5. Vendor JWT can update only its own vendor row / menu items.
6. A signup sending `role=admin` in metadata lands as `student`.
7. An admin JWT can update any vendor's `owner_id`/`preorder_enabled`, delete
   any review, and select all orders — while `rating`/`review_count` stay
   unwritable by any client.
8. Login `tita-nenas@foodherons.local` / `FoodHerons!Demo2026` returns a vendor
   session owning the `tita-nenas` store.
9. Print `current_user` on the seed/service connection; if it is not already in
   the guard triggers' `current_user IN (...)` lists, add it (belt-and-
   suspenders — the authoritative exemption is `request.jwt.claims IS NULL`).
10. Create the first admin:
    `update public.profiles set role='admin' where email='<admin-email>';`
