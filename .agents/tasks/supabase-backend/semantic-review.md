# Phase A — Supabase schema, RLS, triggers, and demo seed

Phase A delivers the FoodHerons backend as pure DDL/DML the user applies by hand in the Supabase SQL editor: six ordered migrations (`0001`–`0006`), a Node seed script that provisions the eight demo vendor accounts through the service-role Admin API, a README, a verification note, and a `.gitignore`/`.env.example` touch so the seed script's secrets stay out of git. No application code runs — the branch is additive and database-only. The implementation tracks the Revision-5 APPROVED design (`design.md` §1–§3, §5, §7) closely: the schema, the two enums, the six functions/triggers, and every RLS policy map onto the design table-by-table and clause-by-clause, and the seed data is transcribed verbatim from `src/data/vendors.js`.

Watch for: nothing blocking. The only items worth a glance are second-order and already acknowledged by the design — the seed script relies on `handle_new_user` firing synchronously enough that a short poll (5s budget) finds each trigger-created vendor row (confirmed, by design); and the review-aggregate path routes a `rating`/`review_count` write past the column guard via a transaction-local GUC flag (confirmed, intentional). Both are the design's own chosen mechanisms, not defects.

**Verdict**: APPROVED

## High-level view

The data model is exactly §1: `numeric(10,2)` money, text slug PKs on `vendors`/`menu_items`, a composite `(vendor_id, id)` menu PK, `order_items` with its only FK to `orders` (no FK to `menu_items`, so price/name snapshots survive menu edits), `reviews.order_id NOT NULL` with the NULL-free `(student_id, vendor_id, order_id)` unique key, and the `DEFAULT auth.uid()` columns on `reviews`/`favorites`. The safe-default rows (`uncategorized`/`unassigned`/`00:00`) exist precisely so the signup trigger's minimal vendor INSERT never trips a NOT NULL or FK violation.

Auth posture matches §3. `handle_new_user` coerces any non-`vendor` role to `student`, so `admin` can never arrive from client metadata; the vendor-row branch is selected by caller (`request.jwt.claims IS NULL` = service/seed honors `store_slug` with `ON CONFLICT DO NOTHING`; any browser caller ignores `store_slug` and slugifies with a collision suffix), closing the crafted-signup slug-hijack the design's Rev-5 finding 1 called out. Role is mirrored into `app_metadata` so the future C# service reads it from the JWT. The two column guards (`guard_vendor_columns`, `guard_profile_role`) both open with the service-role early-return before any `auth_role()` logic, so seed/bootstrap writes are unguarded while browser callers stay restricted.

RLS is enabled on all nine tables and reproduces the §2 matrix: public SELECT on browse tables, no public read on `profiles`, owner-or-admin DML on content tables, admin-only INSERT/DELETE on `vendors`, no client INSERT/UPDATE on `orders`/`order_items` (the Model-2 invariant that keeps money math in the service), a completed-owned-order WITH CHECK on review inserts, and no UPDATE policy anywhere on `favorites`.

The seed splits cleanly along the capability line: `0006` inserts via plain SQL only what the SQL editor can (categories + location_areas, with their safe-default rows), and the Node script owns everything that needs the Admin API (the eight auth users → trigger-created stores → real-column UPDATE → menu upsert). All eight vendors, every menu item, prices, availability flags, and the three longer store names are transcribed verbatim from `vendors.js`.

<details>
<summary>Issues (2)</summary>

1. **Seed poll depends on trigger-commit timing** (possible) — the script polls `vendors` by `owner_id` for up to 5s after `createUser`; if a future GoTrue change defers `handle_new_user` past that window the seed fails loudly (rowcount assertion), which is the designed-for behavior, not a silent drop. No action required; noted so the dependency is explicit.
2. **`.env.example` lives under `supabase/scripts/`, not repo root** (confirmed) — the task brief mentioned a root `.env.example` touch; the actual template is `supabase/scripts/.env.example`, tracked via a correctly-ordered `.gitignore` negation. This is the right location for a seed-script secret template and is not a defect, just a note that the path differs from the brief's phrasing.

</details>

<details>
<summary>Details</summary>

### Data model is a clause-for-clause match to §1

Every table in `0003_tables.sql` lands on the design. Money is `numeric(10,2)` with `check (... >= 0)` on `menu_items.price`, `orders.subtotal`, and `orders.total`. `vendors` and `menu_items` keep text slug PKs; `menu_items` is `primary key (vendor_id, id)` so item ids need only be unique within a vendor. `order_items` carries `menu_item_id` and `vendor_id` as plain columns with the single FK `order_id → orders(id) ON DELETE CASCADE` — no FK to `menu_items`, so a later price edit or item deletion can't rewrite order history, and the snapshot `name`/`unit_price` columns hold the captured values.

`reviews.order_id` is `NOT NULL` and the table carries `unique (student_id, vendor_id, order_id)`; because the key is NULL-free it genuinely enforces one review per completed order (a nullable column would have let Postgres treat NULLs as distinct and defeat the constraint). `reviews.student_id` and `favorites.student_id` both default to `auth.uid()`, matching the design's "client never sends the student id" payload rule while the RLS `WITH CHECK` still pins it to the caller.

The safe-default plumbing is present and correct: `vendors.category DEFAULT 'uncategorized'`, `vendors.location_area DEFAULT 'unassigned'`, both `hours_open`/`hours_close DEFAULT '00:00'`, and `0006` seeds the `uncategorized`/`unassigned` lookup rows the FK defaults point at. That is what lets the signup trigger INSERT a vendor row supplying only `owner_id`, `name`, and `id` without hitting a NOT NULL or FK violation. All the §1 indexes exist (role, category, location_area, owner_id, vendor_id, student_id, `(vendor_id, status)`, placed_at, order_id).

### Signup trigger: admin coercion and caller-based slug branch

`handle_new_user` is the security-sensitive piece and it implements §3 faithfully. Role is coerced with `case when raw_user_meta_data->>'role' = 'vendor' then 'vendor' else 'student' end`, so a crafted `signUp` sending `role: 'admin'` lands as `student` — `admin` is unreachable through the public API. Role is mirrored into `raw_app_meta_data` (not user-writable) for JWT-side reads.

The vendor-row branch is selected by `v_is_service := current_setting('request.jwt.claims', true) is null`. On the service/seed connection it honors `store_slug` verbatim with `ON CONFLICT (id) DO NOTHING`; on any JWT-bearing browser connection it ignores `store_slug` entirely, slugifies `store_name`, and loops a numeric suffix until the id is free before a plain conflict-surfacing INSERT. This is exactly the Rev-5 finding-1 resolution: a browser signup can neither target a canonical seed slug nor end up store-less. Both branches also guard a degenerate/empty slug (service falls back to `vendor-<uuid>`, browser to `store`), so neither can produce a store-less vendor.

### Column guards and the aggregate-write GUC

Both `guard_vendor_columns` and `guard_profile_role` open with the identical service-role early-return — `current_setting('request.jwt.claims', true) is null or current_user in ('postgres','supabase_admin','service_role')` → `return new` — before any `auth_role()` evaluation. This is what makes the §5 seed `UPDATE` of `rating`/`review_count` and the §3 admin-bootstrap `UPDATE profiles SET role='admin'` run unguarded, while browser callers stay restricted. The design's note that `request.jwt.claims IS NULL` is authoritative and the `current_user` list is belt-and-suspenders is carried into the comments verbatim.

The non-obvious mechanism is the review aggregate. `sync_vendor_rating` runs `set_config('foodherons.rating_sync','on',true)` around its `UPDATE vendors SET rating/review_count`, and `guard_vendor_columns` short-circuits on that transaction-local flag. Without it, a client review INSERT (JWT present) would fire the aggregate trigger, whose rating/review_count write would then be rejected by the very guard that protects those columns from clients. The GUC is set only inside that one SECURITY DEFINER function and cleared immediately after, so it doesn't widen the client write surface — it threads the system's own maintenance write through a guard that otherwise correctly denies everyone. This matches the verification note's "ordering hazard found and resolved" and is a sound resolution.

`set_review_snapshot` fills `author_name` from `profiles.full_name` and `ordered_summary` from `order_items` for `NEW.order_id`, both `coalesce`d so the NOT NULL columns are never left null; SECURITY DEFINER lets its internal `order_items` SELECT bypass that table's restrictive policy for the one order being reviewed, which is what lets the public store page render a review with no read access to `profiles` or `order_items`.

### RLS matrix reproduces §2 exactly

RLS is enabled on all nine public tables. `categories`/`location_areas` are public SELECT with no write policy. `profiles` has no public-read policy — own-row-or-admin on all four verbs — so emails and mobiles never leak to anonymous visitors; the store page shows reviewer names via the `author_name` snapshot instead. `vendors` is public SELECT, admin-only INSERT, owner-or-admin UPDATE (with the column guard handling which columns), admin-only DELETE. `menu_items` is public SELECT with owner-of-vendor-or-admin on INSERT/UPDATE/DELETE via an `exists (… vendors v where v.id = menu_items.vendor_id and v.owner_id = auth.uid())` subquery.

The Model-2 invariant holds: `orders` and `order_items` have only SELECT policies — no client INSERT/UPDATE/DELETE — so every write goes through the service-role path and server-side price/total computation can't be bypassed from the browser. `order_items` SELECT is gated on the parent order being visible (or admin), deliberately not loosened for the public store page. `reviews` is public SELECT, INSERT gated on `student_id = auth.uid() and exists (… orders o where o.id = order_id and o.student_id = auth.uid() and o.status = 'completed')`, UPDATE/DELETE author-or-admin. `favorites` has SELECT own-or-admin, INSERT own-only, DELETE own-or-admin, and no UPDATE policy for anyone — matching the design's "membership tuple has nothing mutable" rule.

### Statement ordering is valid Postgres

Apply order 0001→0006 creates every object before use: pgcrypto before the `gen_random_uuid()` defaults; the two enums before the tables that use them; `order_code_seq` before the `orders.code` default that calls `nextval` on it; all FKs reference tables created earlier in `0003` (categories/location_areas before vendors; vendors/profiles before menu_items/orders/reviews/favorites; orders before order_items/reviews); `0004` functions reference existing columns; `0005` policies call `public.auth_role()` from `0004`; and `0006` seeds the `uncategorized`/`unassigned` rows the trigger's minimal INSERT depends on. The enums and tables use `do $$ ... if not exists`/`create table if not exists` guards, so a partial re-run is safe.

### Seed data transcribed verbatim from vendors.js

The split is right: `0006_seed.sql` inserts only what plain SQL can (the six categories + `uncategorized`, the six location_areas + `unassigned`, both `on conflict do update` for idempotency), and `scripts/seed-demo.mjs` owns everything requiring the Admin API. All eight vendors are present with slugs matching the source. Spot-checking prices and flags against `src/data/vendors.js`: tapsilog 75 / tocilog 70 / hotsilog 60 / extra-rice 20 / iced-tea 25, wintermelon 65 / matcha 70 / mango-shake 60 **available:false** / americano 55, through to adobo-bowl 75 / sisig-bowl 85 — all match, including both unavailable items (`mango-shake`, `halohalo`) and `phone` present only on `tita-nenas` (`0917 123 4567`), null elsewhere. The three longer store names are verbatim: `Ate Len Noodle House`, `The Sweet Spot`, `Kuya Boy Smoky Grill`. `full_name` is derived as `"<store_name> (Demo Owner)"` per §5, and the old `desc` field is mapped to the `description` column. Reviews and the per-user `studentSample`/`SEED_ORDERS` artifacts are correctly left unseeded, with `vendors.rating`/`review_count` carrying the historical display numbers as denormalized starting values.

The seed script's idempotency contract is the Rev-5 finding-2 resolution: `resolveOrCreateUser` looks up by email first via paged `listUsers` and only calls `createUser` when absent, with a duplicate-email fallback that re-resolves the id. `waitForVendorRow` polls by `owner_id` with 50ms steps against a 5s budget before the UPDATE, and `applyVendorColumns` asserts the UPDATE matched exactly one row — turning a genuinely missing trigger row into a hard failure rather than a silent no-op. Config reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optional `SEED_VENDOR_PASSWORD` from env; the service-role key is never hardcoded.

### Secrets handling and scope

The `.gitignore` places `!supabase/scripts/.env.example` after the `.env.*` ignore line, so the placeholder template is tracked while real `.env` files stay ignored — the negation order is correct and the comment explains why. `.env.example` carries empty placeholders only and a note that the service-role key bypasses RLS and must never reach a `VITE_` var. The diff is additive: the only modified (not newly added) file is `.gitignore`, and a name-only scan confirms no `src/`, `.jsx`, `.cs`, or `package.json` changes — no frontend, C#, or `src/data` edits, consistent with the database-only mandate.

</details>

<details>
<summary>File map</summary>

- `supabase/migrations/0001_extensions.sql` — `create extension if not exists pgcrypto` for `gen_random_uuid()`.
- `supabase/migrations/0002_enums.sql` — `user_role` (student/vendor/admin) and `order_status` enums, guarded by `if not exists`.
- `supabase/migrations/0003_tables.sql` — all nine tables + `order_code_seq`, matching §1 exactly.
- `supabase/migrations/0004_functions_triggers.sql` — `auth_role`, `handle_new_user`, `guard_vendor_columns`, `guard_profile_role`, `set_review_snapshot`, `sync_vendor_rating` and their triggers.
- `supabase/migrations/0005_rls.sql` — RLS enable + every §2 policy on all nine tables.
- `supabase/migrations/0006_seed.sql` — categories + location_areas (with safe-default rows), `on conflict do update`.
- `supabase/scripts/seed-demo.mjs` — Node Admin-API seed for the 8 demo vendor accounts, stores, and menu items.
- `supabase/scripts/.env.example` — placeholder env template for the seed script (tracked via .gitignore negation).
- `supabase/README.md` — apply order and getting-started notes.
- `supabase/PHASE-A-VERIFICATION.md` — manual dashboard verification checklist.
- `.gitignore` — adds the `!supabase/scripts/.env.example` negation after `.env.*`.

Full diff: `git -C .worktrees/phase-a-supabase-sql diff main...phase-a-supabase-sql`.

</details>
