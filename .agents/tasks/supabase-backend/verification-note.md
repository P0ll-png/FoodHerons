# Phase A — Verification Note

No local Postgres or Supabase connection exists in this environment, so the SQL
was **not executed** and the seed script was **not run** against any database.
Verification is static review + a Node syntax check, per the task's verification
rules. Evidence below.

## What was checked and how

### (a) Schema matches design §1 (tables/columns/constraints/PK/FK/index)

Cross-read `0003_tables.sql` against design §1 table-by-table:

- **categories** — `id text PK`, `name text NOT NULL`, `image text`,
  `sort_order int NOT NULL DEFAULT 0`. ✓
- **location_areas** — `id text PK`, `name NOT NULL`, `sort_order`. ✓ (id=name=value seeded in 0006)
- **profiles** — `id uuid PK → auth.users(id) ON DELETE CASCADE`, `role user_role NOT NULL`,
  `full_name NOT NULL`, `email NOT NULL`, `mobile` nullable, `avatar_url` nullable,
  `created_at`/`updated_at` default now(); index on `role`. ✓
- **vendors** — `id text PK`; `owner_id uuid → profiles(id)` nullable; `name NOT NULL`;
  `category text NOT NULL DEFAULT 'uncategorized' → categories(id)`;
  `location_area text NOT NULL DEFAULT 'unassigned' → location_areas(id)`;
  `description NOT NULL DEFAULT ''`; `hours_open/close NOT NULL DEFAULT '00:00'`;
  `rating numeric(2,1) NOT NULL DEFAULT 0`; `review_count int NOT NULL DEFAULT 0`;
  `phone` nullable; `preorder_enabled boolean NOT NULL DEFAULT false`;
  `cover_tint NOT NULL DEFAULT 'var(--orange-soft)'`; `logo_url`/`cover_url` nullable;
  indexes on category, location_area, owner_id. ✓
- **menu_items** — composite `PRIMARY KEY (vendor_id, id)`; `vendor_id → vendors(id) ON DELETE CASCADE`;
  `price numeric(10,2) NOT NULL CHECK (price >= 0)`; `category → categories(id)`;
  `available NOT NULL DEFAULT true`; `description` nullable (old `desc`); index on vendor_id. ✓
- **order_code_seq** — `CREATE SEQUENCE` created before `orders`. ✓
- **orders** — `id uuid PK DEFAULT gen_random_uuid()`;
  `code text NOT NULL UNIQUE DEFAULT ('FH-' || lpad(nextval(order_code_seq)::text, 6, '0'))`;
  `student_id → profiles(id)`; `vendor_id → vendors(id)`; `status order_status NOT NULL DEFAULT 'pending'`;
  `subtotal`/`total numeric(10,2) NOT NULL CHECK >= 0`; `pickup_name NOT NULL`; `note`/`cancel_reason` nullable;
  lifecycle timestamps; indexes on student_id, (vendor_id,status), placed_at. ✓
- **order_items** — `id uuid PK`; `order_id → orders(id) ON DELETE CASCADE` (the ONLY FK);
  `menu_item_id`/`vendor_id` plain columns (NO FK to menu_items); `name`, `unit_price numeric(10,2)`,
  `qty int CHECK (qty > 0)`; index on order_id. ✓
- **reviews** — `id uuid PK`; `vendor_id → vendors(id) ON DELETE CASCADE`;
  `student_id uuid NOT NULL DEFAULT auth.uid() → profiles(id)`; `order_id uuid NOT NULL → orders(id)`;
  `author_name NOT NULL`; `ordered_summary NOT NULL DEFAULT ''`;
  `rating int CHECK (rating between 1 and 5)`; `text` nullable; `helpful_count NOT NULL DEFAULT 0`;
  `UNIQUE (student_id, vendor_id, order_id)`; indexes on vendor_id, student_id. ✓
- **favorites** — composite `PRIMARY KEY (student_id, vendor_id)`;
  `student_id uuid NOT NULL DEFAULT auth.uid() → profiles(id) ON DELETE CASCADE`;
  `vendor_id → vendors(id) ON DELETE CASCADE`; index on student_id. ✓

### Functions/triggers match design §2/§3 (`0004_functions_triggers.sql`)

- **`public.auth_role()`** — `LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public`,
  returns `user_role` from `profiles WHERE id = auth.uid()`; not named `current_role`. ✓
- **`handle_new_user()`** — SECURITY DEFINER; coerces any `role != 'vendor'` to `student`
  (so `admin` can never come from signup); reads `full_name`/`role`/`mobile`/`store_name`/`store_slug`;
  provisions `profiles`; mirrors role into `auth.users.raw_app_meta_data`; for vendors uses the
  **caller-based** branch: `request.jwt.claims IS NULL` (service/seed) → honor `store_slug` +
  `ON CONFLICT (id) DO NOTHING`; otherwise slugify `store_name` with numeric-suffix-on-collision and a
  plain conflict-surfacing INSERT. Attached `AFTER INSERT on auth.users`. ✓
- **`guard_vendor_columns()`** — BEFORE UPDATE on vendors; first check is the service-role
  early-return (`request.jwt.claims IS NULL OR current_user IN (...)`); blocks client writes to
  `rating`/`review_count` (admin included); allows `owner_id` change only for `auth_role()='admin'`.
  An internal `foodherons.rating_sync` session flag lets the aggregate trigger's own write through. ✓
- **`guard_profile_role()`** — BEFORE UPDATE on profiles; same service early-return; blocks a non-admin
  from changing `role`; admin may change another user's role. ✓
- **`set_review_snapshot()`** — BEFORE INSERT on reviews, SECURITY DEFINER; fills `author_name` from
  `profiles.full_name` (auth.uid()) and `ordered_summary` from `order_items` for `NEW.order_id`. ✓
- **`sync_vendor_rating()`** — AFTER INSERT and AFTER DELETE on reviews; recomputes
  `vendors.rating = round(avg(rating),1)` and `review_count = count(*)`; sets/clears the
  `foodherons.rating_sync` flag around its UPDATE so the column guard permits it even inside a
  JWT-bearing request. ✓

Note on an ordering hazard found and resolved during review: the reviews→vendor aggregate UPDATE runs
in the same request as the client review INSERT (JWT context present), so `guard_vendor_columns` would
otherwise reject the rating/review_count change. The aggregate function sets a transaction-local GUC
(`set_config('foodherons.rating_sync','on',true)`) that the guard checks and short-circuits on,
preserving the design's "rating/review_count are trigger-maintained, unwritable by clients" rule
without weakening it for actual client writes.

### RLS matches design §2 (`0005_rls.sql`)

- RLS enabled on all 9 public tables. ✓
- **categories/location_areas** — public SELECT, no client writes. ✓
- **profiles** — own-row SELECT/INSERT/UPDATE/DELETE OR admin; no public read. ✓
- **vendors** — public SELECT; INSERT admin-only; UPDATE owner-or-admin; DELETE admin-only. ✓
- **menu_items** — public SELECT; INSERT/UPDATE/DELETE owner-of-vendor OR admin. ✓
- **orders** — SELECT student/owning-vendor/admin; NO client INSERT/UPDATE; no DELETE. ✓
- **order_items** — SELECT if parent order visible OR admin; NO client INSERT/UPDATE; no DELETE. ✓
- **reviews** — public SELECT; INSERT student on a completed owned order; UPDATE/DELETE author-or-admin. ✓
- **favorites** — SELECT own-or-admin; INSERT own-only; DELETE own-or-admin; NO UPDATE for anyone. ✓

### (b) Statement ordering / referenced objects exist before use

Apply order 0001→0006: extensions → enums → tables (+ sequence) → functions/triggers → RLS → seed.
- `gen_random_uuid()` available via pgcrypto (0001) before `orders`/`order_items`/`reviews` defaults (0003). ✓
- enums (0002) exist before tables that use `user_role`/`order_status` (0003). ✓
- `order_code_seq` created before the `orders.code` default references it (both in 0003, sequence first). ✓
- All FKs reference tables already created earlier in 0003 (categories/location_areas before vendors;
  vendors/profiles before menu_items/orders/reviews/favorites; orders before order_items/reviews). ✓
- Functions in 0004 reference existing columns (profiles, order_items, vendors, reviews). ✓
- RLS policies (0005) call `public.auth_role()` created in 0004. ✓
- Seed (0006) inserts the `uncategorized`/`unassigned` lookup rows the trigger's minimal vendor INSERT
  depends on. ✓

### (c) All 8 vendors + menu items present in the seed script with correct prices/flags

`scripts/seed-demo.mjs` `VENDORS[]` transcribed from `src/data/vendors.js`:
- 8 vendors: tita-nenas, campus-brews, crunch-corner, noodle-house, sweet-spot, smoky-grill,
  brekkie-cart, rice-rush. ✓
- Per-vendor category/location_area/description/hours_open/hours_close/rating/review_count
  (the `reviews` number)/phone/preorder_enabled/cover_tint match the source. `phone` only present for
  tita-nenas (`0917 123 4567`); null elsewhere. ✓
- Menu items with id/name/price/category/available/description match the source, including the two
  unavailable items (`mango-shake`, `halohalo`). Prices are numeric (75, 70, …) and stored into
  `numeric(10,2)` columns. ✓

### (d) Demo store names match design §5 table

`store_name` values are verbatim from `vendors.js`, including the three longer names flagged in §5:
`noodle-house` = "Ate Len Noodle House", `sweet-spot` = "The Sweet Spot",
`smoky-grill` = "Kuya Boy Smoky Grill". `full_name` is derived as `"<store> (Demo Owner)"`. ✓

### Node syntax check

`node --check supabase/scripts/seed-demo.mjs` → exit 0 (parses; NOT executed). ✓

## Seed-script behavior confirmed by reading (not executed)

- Lookup-first/create-if-absent per account (`findUserByEmail` → `createUser` only when absent;
  duplicate-email error falls back to lookup). Idempotent re-run. ✓
- Poll-then-update: `waitForVendorRow(owner_id)` polls `vendors` by `owner_id` with ~50ms backoff
  (5s budget) before the UPDATE; UPDATE keyed on `owner_id`, asserts exactly 1 row matched. ✓
- Menu items upserted on conflict `(vendor_id, id)`. ✓
- Config from env (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `SEED_VENDOR_PASSWORD`);
  service-role key never hardcoded. ✓

## Manual dashboard steps the user must still run (full verification)

Static review cannot execute SQL; the §7 checklist must be run against the live project:
1. Apply 0001–0006 in order (no errors).
2. Anon `select` returns 8 vendors + menus (after the seed script runs).
3. Student JWT: cannot insert `orders`; cannot update another vendor's `menu_items`.
4. Vendor JWT: can update only its own vendor/menu rows.
5. Signup with `role=admin` metadata lands as `student`.
6. Admin JWT: can update any vendor `owner_id`/`preorder_enabled`, delete any review, select all
   orders; `rating`/`review_count` remain unwritable by any client.
7. Login `tita-nenas@foodherons.local` / `FoodHerons!Demo2026` → vendor session owning `tita-nenas`.
8. Confirm the seed/service connection's `current_user` and, if it is not in
   (`postgres`,`supabase_admin`,`service_role`), add it to the guard trigger lists (belt-and-suspenders;
   the authoritative exemption is `request.jwt.claims IS NULL`).
