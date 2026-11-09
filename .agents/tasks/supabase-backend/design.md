# FoodHerons — Supabase + C# Backend Integration: Technical Design

Status: Revision 5 (final) — folds in two new user-approved decisions on top of the APPROVED Revision 3 design: **(Change 1) an `admin` role + admin dashboard** (reversing the earlier "no admin" decision), and **(Change 2) seed vendors get pre-seeded fake-email owner accounts** (claimable demo logins), replacing the earlier owner-less seed vendors. The Rev 4 review loop converged over several rounds on the seed/trigger path; its final `design-verdict.json` left **2 MEDIUM + 3 NIT**, all confined to Change 2's seed/trigger path (Change 1's admin role/dashboard/RLS/escalation-guard passed every checklist item). **Revision 5 resolves those final 5 findings directly** (applied by the orchestrator after the design-update workflow hit its iteration cap): (1) the signup-trigger vendor-insert branch is now selected by **caller** — service connection (`request.jwt.claims IS NULL`) vs. JWT browser caller — instead of by the client-controllable `store_slug` flag, so a crafted self-signup can neither target a seed slug nor end up store-less; (2) the seed script now follows an explicit **lookup-first, create-if-absent** contract so re-runs are genuinely idempotent despite `admin.createUser` rejecting duplicate emails; (3) the §4 `PlaceOrderResponse` example code is corrected to the 6-digit `FH-000142` form; (4) the `Cart.jsx` order-object citation corrected to `:32-41`; (5) the `App.jsx` routes-block citation corrected to `:40-50`. See the first subsection of "Responses to review findings". Earlier history: Rev 4 resolved the admin `NOT NULL` set, the service-role trigger exemption, the demo `full_name`/`.local` specifics, the seed-ordering poll+assert robustness, and the verbatim store names; Revision 3 addressed the 3 NITs of its review (verdict APPROVED); Revision 2 resolved the prior 5 findings; Revision 1 resolved the original 13 (all recaps kept at the end). DESIGN ONLY — no application code, SQL, or project scaffolding is produced in this pass.

## Overview

FoodHerons is today a frontend-only React 18.3 + react-router-dom 6.26 + Vite 5.4 app (plain JSX, no TypeScript). All domain data is hardcoded in `src/data/vendors.js`, `src/data/reviews.js`, and `src/data/studentSample.js`; "live" edits persist only to `localStorage`/`sessionStorage`; and auth is faked by `DEMO_MODE`/`PREVIEW_USER` shims. This design converts it into a full-stack app on the decided **Model 2** architecture:

- **Supabase Auth** owns login/signup/sessions/JWT. The React client talks to it directly via `@supabase/supabase-js` (a new frontend dependency).
- **Supabase Postgres + Row-Level Security (RLS)** owns **all** application data. Schema, policies, and seed data are SQL migrations living in the Supabase project (not EF Core).
- The React client reads/writes **most** data directly through the Supabase client; RLS enforces per-role, per-owner access.
- A narrow **ASP.NET Core Web API on .NET 10** owns **exactly one** responsibility: **order placement and order status transitions**. It validates the cart against live DB prices, computes totals server-side, writes orders with the Supabase **service-role** key (bypassing RLS for that privileged write), and authorizes callers by validating their Supabase JWT.
- **Three roles:** `student`, `vendor`, and `admin`. One role per account. `student` and `vendor` are self-chosen at signup; **`admin` is assigned manually in the database only** — there is no admin signup path and `admin` is never selectable on the Signup form. An admin is a moderation/management superuser at the RLS layer (it bypasses owner/role checks on the content tables) and gets its own `/admin` dashboard surface.

The guiding principle: the database is the single source of truth, RLS is the primary authorization boundary for direct client access, and the C# service is a thin privileged gate only where client-trust is unacceptable (money math and order lifecycle).

### Technology stack (LOCKED once approved)

| Layer | Choice |
| --- | --- |
| Frontend | React 18.3, react-router-dom 6.26, Vite 5.4, plain JSX (no TS migration) |
| Supabase client | `@supabase/supabase-js` v2 (new dependency) |
| Auth | Supabase Auth (email/password; Facebook OAuth deferred — see Open Questions) |
| Database | Supabase Postgres (project already provisioned by user) |
| DB authz | Postgres Row-Level Security policies |
| Migrations/seed | Supabase SQL migrations (`supabase/migrations/*.sql`), applied via Supabase CLI or SQL editor |
| Order service | ASP.NET Core Web API (Minimal APIs), .NET 10 (SDK 10.0.401) |
| Service → DB | Npgsql (direct Postgres connection) using the service-role connection string |
| JWT validation | `Microsoft.AspNetCore.Authentication.JwtBearer` validating Supabase-issued JWTs |
| Secrets | `.env.local` (frontend, Vite), .NET user-secrets / `.env` (service) — all git-ignored |

Note on the stale comment in `src/data/vendors.js:2` ("Supabase (MySQL)") — the target is Supabase **Postgres**, not MySQL. That comment disappears when the file is deleted in Phase B.

---

## 1. Data model

All tables live in the `public` schema and reference Supabase's `auth.users` (managed by Supabase Auth). Monetary values are whole pesos today (every price in `vendors.js` is an integer: 75, 25, 20, …). To stay safe for future centavo pricing, store money as `integer` **centavos** is overkill for the current data; the data is whole-peso. **Decision:** use `numeric(10,2)` for prices/totals. This matches "cash on pickup" peso amounts, avoids float rounding, and lets the C# service compute totals exactly. Seed values insert as `75.00`, etc.

IDs: the current JS uses human-readable string slugs (`'tita-nenas'`, `'tapsilog'`). **Decision:** vendors and menu_items keep **text slug PKs** carried over verbatim from the seed data, because the frontend routes on them (`/vendor/:id` uses `vendor.id`; the cart keys quantities by `menu item id`; `getReviewsFor` hashes `vendor.id`). Keeping slugs means seed rows, routes, and cart keys all stay stable and the rewrite doesn't have to translate ids. Orders use generated UUIDs (the `FH-####` strings were random demo ids, not real keys) plus a separate human-friendly `code` column for display.

### Enums

```
order_status: 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled'
user_role:    'student' | 'vendor' | 'admin'
```

The `user_role` enum gains a third value, `admin` (lowercase, consistent with the other roles). `admin` is **not** a self-service role: it is never written by the signup trigger from client-supplied metadata (see §3's privilege-escalation guard) and never appears on the Signup form — it exists only to be set manually on a `profiles` row in the database.

`order_status` and `user_role` are the **only** Postgres enums; they are true closed domains.

**Categories are a lookup table, not an enum.** Create `categories(id text PK, name text NOT NULL, image text, sort_order int NOT NULL DEFAULT 0)`, seeded from the six `categories[]` rows in `vendors.js:5-12` (`rice`/`snacks`/`drinks`/`desserts`/`noodles`/`grill`, each with its display `name` and `image`), **plus one safe-default row `('uncategorized', 'Uncategorized', null, 99)`** so the `vendors.category` default below satisfies its FK (see the trigger note). `vendors.category` and `menu_items.category` are `text NOT NULL REFERENCES categories(id)`. **No `menu_category` enum is created.** The table is chosen over an enum because the current code already treats categories as data (with `name` + `image` for the filter chips and tiles via `categoryName()`), and a table avoids an enum migration if a seventh category is ever added.

**Location areas are a lookup table too (integrity decision).** Create `location_areas(id text PK, name text NOT NULL, sort_order int NOT NULL DEFAULT 0)`, seeded from the six `locationAreas[]` values in `vendors.js:14-21` (`Main Gate`, `HPSB Building`, `Admin Lobby`, `Covered Court`, `Food Court`, `Back Gate`), **plus one safe-default row `('unassigned', 'Unassigned', 99)`** so the `vendors.location_area` default below satisfies its FK (see the trigger note). `vendors.location_area` is `text NOT NULL REFERENCES location_areas(id)`. **Decision — committed, not an either/or:** a lookup table (not a free-text column, and not a bare CHECK constraint) is the enforcement mechanism, chosen for symmetry with the `categories` decision above and because the Home/Search location filter chips are driven by this fixed list. The DB is therefore the integrity boundary: the RLS-guarded vendor `UPDATE` path (`updateVendorInfo`, `VendorContext.jsx:90-99`) cannot write an off-list string — the FK rejects it — so a store can never become unfilterable by the fixed-list location chips. A CHECK constraint was rejected because adding a campus area would then require a schema migration, whereas a new `location_areas` row is plain data (the same reason categories is a table). For the `id`, the seed uses the human-readable value itself as the PK (e.g. `id = 'Food Court'`) so `vendors.location_area` carries the display string verbatim from the seed data and the rewrite doesn't have to translate it; `name` repeats it for a uniform `{id, name}` shape with `categories`.

### Tables

**profiles** — one row per auth user; holds role and display fields currently faked by the auth shim (`name`, `email`, `mobile`, `avatar`, `role`).

| column | type | constraints |
| --- | --- | --- |
| id | uuid | PK, FK → `auth.users(id)` on delete cascade |
| role | user_role | not null |
| full_name | text | not null |
| email | text | not null (mirror of auth email for display/joins) |
| mobile | text | null (PH mobile, 10-digit national form, see validation) |
| avatar_url | text | null |
| created_at | timestamptz | not null default now() |
| updated_at | timestamptz | not null default now() |

Indexes: PK on `id`; index on `role` (dashboards filter by role rarely, but RLS/admin queries benefit).

**vendors** — from `vendors[]` in `vendors.js`.

| column | type | constraints |
| --- | --- | --- |
| id | text | PK (slug, e.g. `tita-nenas`) |
| owner_id | uuid | FK → `profiles(id)`; **nullable** by schema, but every seed vendor now ships **owned by a pre-seeded fake-email demo account** (Change 2 / §5), so no seed row is owner-less in practice; nullable is retained only so the schema can tolerate a transiently owner-less store if an admin unassigns one (see Open Questions Q4) |
| name | text | not null |
| category | text | not null **default `'uncategorized'`**, FK → `categories(id)` |
| location_area | text | not null **default `'unassigned'`**, FK → `location_areas(id)` (one of the six seeded values, or the `'unassigned'` default) |
| description | text | not null default '' |
| hours_open | text | not null default '00:00' ("HH:MM", e.g. `06:30`) |
| hours_close | text | not null default '00:00' ("HH:MM") |
| rating | numeric(2,1) | not null default 0 (denormalized avg, e.g. 4.8) |
| review_count | integer | not null default 0 (denormalized count; current `reviews` field) |
| phone | text | null (e.g. `0917 123 4567`) |
| preorder_enabled | boolean | not null default false |
| cover_tint | text | not null default 'var(--orange-soft)' |
| logo_url | text | null |
| cover_url | text | null |
| created_at / updated_at | timestamptz | not null default now() |

Notes: `isOpen` is **NOT stored** — it is derived at read time from `hours_open`/`hours_close` by the existing `isOpenNow()` helper in `VendorContext.jsx:21-26`. That logic stays client-side for display (it depends on "now", which the server shouldn't freeze into a column). The hours are **Philippine local wall-clock** values (e.g. `06:30`); any server-side re-evaluation (the C# place-order check, §4) must compare them in `Asia/Manila` (UTC+8, no DST), not server UTC. The `'00:00'` **default** on both columns (added so the signup trigger can create a vendor row without supplying hours — see §3) also fails safe: a never-configured store has `hours_open = hours_close = '00:00'`, and `isOpenNow()`'s non-wrap branch (`start <= end ? m >= start && m < end`) is `m >= 0 && m < 0`, which is false for every minute `m`. So an unconfigured store correctly reads **closed** until its owner sets real hours — the desired safe default. The **`category`/`location_area` defaults (`'uncategorized'`/`'unassigned'`) exist for the same reason the `'00:00'` hours default does:** the `handle_new_user` signup trigger (§3) creates a vendor row supplying only `owner_id`, `name`, and `id`, and both of those columns are `NOT NULL`; without a default (that itself satisfies the FK to the seeded `uncategorized`/`unassigned` rows above) the trigger's minimal INSERT would fail a `NOT NULL`/FK violation — breaking both self-signup vendors (the trigger is the sole writer of their row) and every Change-2 seed demo account (Phase A deliberately lets the trigger create each seed store, §5). A never-configured store therefore lands as `uncategorized`/`unassigned` (and `closed`) until its owner or the §5 seed-script `UPDATE` overwrites the real values; both are plain data edits, not schema changes. `rating`/`review_count` are denormalized aggregates maintained from the `reviews` table (see invariants). Indexes: PK on `id`; index on `category`; index on `location_area`; index on `owner_id`.

**menu_items** — from each vendor's `menu[]`.

| column | type | constraints |
| --- | --- | --- |
| id | text | part of composite PK `(vendor_id, id)` (slug, e.g. `tapsilog`) |
| vendor_id | text | not null, FK → `vendors(id)` on delete cascade |
| name | text | not null |
| price | numeric(10,2) | not null, check `price >= 0` |
| category | text | not null, FK → `categories(id)` |
| available | boolean | not null default true |
| description | text | null (current `desc` field) |
| image_url | text | null |
| sort_order | integer | not null default 0 |
| created_at / updated_at | timestamptz | not null default now() |

Decision on PK: **the PK is composite `(vendor_id, id)`** so two vendors could each have an `extra-rice`. (Menu item ids happen to be globally unique in the current `vendors.js` data, but composite is the committed rule — an item id is only semantically unique within its vendor.) The cart keys by item id within a known vendor, so `(vendor_id, id)` lookups are exactly what the cart needs. The frontend currently assumes a bare `item.id`; the rewrite will always have `vendor_id` in context (cart is single-vendor), so this is safe. Index: PK `(vendor_id, id)`; index on `vendor_id`.

**orders** — replaces the `sessionStorage` order blob written in `Cart.jsx:30-44` (the `placeOrder` body: the order object at `:32-41` and the `sessionStorage.setItem(\`order-${orderId}\`, …)` call at `:43`) and the Dashboard `SEED_ORDERS`.

| column | type | constraints |
| --- | --- | --- |
| id | uuid | PK default `gen_random_uuid()` |
| code | text | not null unique (human id, e.g. `FH-000142`; `'FH-' || lpad(nextval('order_code_seq')::text, 6, '0')`, backed by a Postgres sequence) |
| student_id | uuid | not null, FK → `profiles(id)` |
| vendor_id | text | not null, FK → `vendors(id)` |
| status | order_status | not null default 'pending' |
| subtotal | numeric(10,2) | not null, check `>= 0` (server-computed) |
| total | numeric(10,2) | not null, check `>= 0` (server-computed; == subtotal today, no fees/tax) |
| pickup_name | text | not null (from the checkout form, `Cart.jsx` `pickupName`) |
| note | text | null (checkout "Special Instructions") |
| cancel_reason | text | null (vendor reject reason; `REJECT_REASONS` in Dashboard) |
| placed_at | timestamptz | not null default now() |
| accepted_at / ready_at / completed_at / cancelled_at | timestamptz | null (lifecycle timestamps) |

Indexes: PK on `id`; unique on `code`; index on `student_id` (Profile order lists); index on `(vendor_id, status)` (Dashboard tabs filter by status per vendor); index on `placed_at`.

The display code is backed by a Postgres sequence created in Phase A: `CREATE SEQUENCE order_code_seq;`. The order code is assigned at insert as `'FH-' || lpad(nextval('order_code_seq')::text, 6, '0')` (either as a column `DEFAULT` or computed by the C# service in the same transaction). A sequence makes collisions impossible and gives a durable, monotonically increasing human id, so there is **no retry loop**. This replaces the old random `FH-####` (a 9000-value space that the current `Cart.jsx` generated with `Math.floor(1000 + random*9000)` and that would collide as orders accumulate).

**order_items** — line items captured at order time (price snapshot so later menu edits don't rewrite history).

| column | type | constraints |
| --- | --- | --- |
| id | uuid | PK default `gen_random_uuid()` |
| order_id | uuid | not null, FK → `orders(id)` on delete cascade |
| menu_item_id | text | not null (slug; soft reference, see note) |
| vendor_id | text | not null (for the composite FK) |
| name | text | not null (snapshot of item name) |
| unit_price | numeric(10,2) | not null (snapshot of price at order time) |
| qty | integer | not null, check `qty > 0` |

Note: `order_items.menu_item_id` and `order_items.vendor_id` are plain columns with **NO foreign key** to `menu_items`. The line is a historical snapshot: `name` and `unit_price` are copied from the menu item at insert time and never change afterward. Rationale: a menu-item deletion or price edit must not alter or null out historical order lines (and it keeps the id available for a future "reorder"). The `order_id` FK to `orders` (ON DELETE CASCADE) is the only FK on this table. Index: `order_id`.

**reviews** — replaces the procedurally-generated `reviews.js` pool. Current reviews are fabricated from a `POOL` keyed by `vendor.id`; real reviews are per student per vendor (optionally per completed order).

| column | type | constraints |
| --- | --- | --- |
| id | uuid | PK default `gen_random_uuid()` |
| vendor_id | text | not null, FK → `vendors(id)` on delete cascade |
| student_id | uuid | not null, **default `auth.uid()`**, FK → `profiles(id)` |
| order_id | uuid | **not null**, FK → `orders(id)` (the completed order being reviewed; `PENDING_REVIEWS` implies this) |
| author_name | text | not null (snapshot of `profiles.full_name` at insert time; see trigger below) |
| ordered_summary | text | not null default '' (snapshot of the reviewed order's line items, e.g. `"2× Tapsilog, 1× House Iced Tea"`; see trigger below) |
| rating | integer | not null, check `rating between 1 and 5` |
| text | text | null |
| helpful_count | integer | not null default 0 |
| created_at | timestamptz | not null default now() |

Constraint: unique `(student_id, vendor_id, order_id)` so a student reviews a given order once. Because `order_id` is `NOT NULL`, this unique key is NULL-free and genuinely enforces one-review-per-order (a UNIQUE over a nullable column would not, since Postgres treats NULLs as distinct). Indexes: index on `vendor_id` (store page), index on `student_id` (Profile "Past reviews"). The `ordered` string (`"1× Tapsilog"`) shown in the UI reads the `ordered_summary` snapshot column directly off the review row — it is **not** joined from `order_items` at read time (see the trigger note and §2 for why).

**`author_name` and `ordered_summary` are set by a trigger, not trusted from the client, and not joined at read time.** A single `BEFORE INSERT` trigger (`set_review_snapshot`, `SECURITY DEFINER`) fills both snapshot columns:
- `NEW.author_name := (SELECT full_name FROM profiles WHERE id = auth.uid())`.
- `NEW.ordered_summary := (SELECT COALESCE(string_agg(qty || '× ' || name, ', '), '') FROM order_items WHERE order_id = NEW.order_id)`.

Both let the **public** store page render a review (reviewer name + the "Ordered: 2× Tapsilog" line) **without any read access to `profiles` or `order_items`**, which the store page's anonymous/non-owner audience does not have (see §2). Snapshotting at insert time mirrors how the `ordered` string was already a per-review display string in the old `reviews.js` (`"1× Tapsilog"`), is immutable history (a later menu rename or order-line edit must not rewrite a posted review), and a client cannot spoof either value because the trigger overwrites whatever the client supplied. The trigger is `SECURITY DEFINER` so its internal `SELECT` from `order_items` bypasses that table's restrictive SELECT policy for the one order being reviewed (which the caller owns anyway, since the reviews `WITH CHECK` requires it).

**favorites** — implied by `studentSample.js` `FAVORITES` and the Profile favorites grid.

| column | type | constraints |
| --- | --- | --- |
| student_id | uuid | not null, **default `auth.uid()`**, FK → `profiles(id)` on delete cascade |
| vendor_id | text | not null, FK → `vendors(id)` on delete cascade |
| created_at | timestamptz | not null default now() |

PK: composite `(student_id, vendor_id)`. Index on `student_id`. Both `reviews.student_id` and `favorites.student_id` carry `DEFAULT auth.uid()` so the client insert payload never needs to send the student id; the RLS `WITH CHECK (student_id = auth.uid())` still holds because the default equals `auth.uid()` (and a client that supplies a different id is rejected by the check).

**Cart persistence:** the cart is intentionally **not** a server table. It is single-vendor, ephemeral, and today lives in a `useReducer` (`CartContext.jsx`). **Decision:** keep the cart client-side only (optionally persist to `localStorage` as today). Persisting carts server-side adds RLS surface for no product requirement; the authoritative moment is order placement, which the C# service validates. This is called out explicitly in Open Questions Q2.

### ER description

```
auth.users (Supabase) 1───1 profiles              (profiles.role ∈ {student, vendor, admin})
profiles(role=vendor) 1───0..* vendors            (vendors.owner_id → profiles.id; an admin may re-point owner_id to any profile)
vendors               1───*    menu_items          (menu_items.vendor_id → vendors.id)
vendors               1───*    orders              (orders.vendor_id → vendors.id)
profiles(role=student)1───*    orders              (orders.student_id → profiles.id)
orders                1───*    order_items          (order_items.order_id → orders.id)
vendors               1───*    reviews              (reviews.vendor_id → vendors.id)
profiles(role=student)1───*    reviews              (reviews.student_id → profiles.id)
orders                1───0..1   reviews             (reviews.order_id → orders.id; one review per completed order)
profiles(role=student)*───*    vendors via favorites
categories            1───*    vendors / menu_items (category FK)
location_areas        1───*    vendors              (vendors.location_area → location_areas.id)
```

---

## 2. Row-Level Security policies

RLS is **enabled on every public table**. The Supabase anon/auth clients always run as the calling user (JWT → `auth.uid()`); the C# service connects with the **service-role** connection which **bypasses RLS entirely** (so the policies below only constrain the direct-from-browser path).

Helper: a SQL function `public.auth_role()` returns the caller's `profiles.role`, used in policies. It must **not** be named `current_role` (that is a Postgres built-in that returns the SQL role name) and it must **not** re-trigger RLS on `profiles` (a policy that reads `profiles` while evaluating a `profiles` policy would recurse). It is therefore `SECURITY DEFINER STABLE` and reads `profiles` with RLS bypassed:

```sql
CREATE FUNCTION public.auth_role() RETURNS user_role
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
  AS $$ SELECT role FROM profiles WHERE id = auth.uid() $$;
```

Because it is `SECURITY DEFINER` owned by a privileged role, its internal `SELECT role FROM profiles` does not re-enter RLS, so it is safe to call from inside the `profiles` policies themselves. All policy rows below that say "vendor" / "student" test `public.auth_role() = 'vendor'` / `'student'`.

**Admin is an RLS superuser for the content tables (Change 1).** An `admin` must be able to SELECT/INSERT/UPDATE/DELETE across `vendors`, `menu_items`, `orders`, `order_items`, `reviews`, `profiles`, and `favorites` for moderation/management. Rather than widen each `USING`/`WITH CHECK` ad hoc, every policy that previously gated on owner/role is rewritten as **`<existing owner/role predicate> OR public.auth_role() = 'admin'`**, and each affected table additionally gets an explicit admin policy for the DML verbs it previously denied to clients (so an admin can, e.g., INSERT a `vendors` row or DELETE a `reviews` row even though ordinary clients cannot). Concretely, the admin predicate is added per table in the table below; where a verb's client policy was "none", a dedicated `admin-only` policy (`USING public.auth_role() = 'admin'` / `WITH CHECK public.auth_role() = 'admin'`) is added alongside it. The service-role C# path is unaffected (it already bypasses RLS entirely); admin RLS governs the admin's **direct-from-browser** access under the anon/auth key. Admin does **not** get write access to `orders`/`order_items` **writes** beyond read — order creation and status transitions stay the C# service's job even for admins (the admin dashboard's order view is read-only; see §3) — but admin **does** get full SELECT on orders/order_items for the cross-vendor view.

Legend: "**or admin**" in a cell means the predicate is `<stated predicate> OR public.auth_role() = 'admin'`. Where a cell was "none from client" and now reads "**admin only**", a dedicated policy `USING/WITH CHECK public.auth_role() = 'admin'` is added so admins (and only admins) get that verb from the browser.

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| **categories** | anyone (anon + auth) | none from client (seeded only) | none | none |
| **location_areas** | anyone (anon + auth) | none from client (seeded only) | none | none |
| **vendors** | anyone | **admin only** (admins may create a vendor row; ordinary clients still none — vendor rows are otherwise trigger-created, see note) | owner (`owner_id = auth.uid()`) **or admin** — owner may edit info/hours/preorder/logo/cover and may NOT change `owner_id`, `rating`, `review_count`; an **admin may also change `owner_id`** (the "assign/claim" tool) and toggle `preorder_enabled`/edit store info (the column guard trigger distinguishes the admin caller — see note) | **admin only** (ordinary clients still none) |
| **menu_items** | anyone | vendor owner of `vendor_id` **or admin** | vendor owner of `vendor_id` **or admin** | vendor owner of `vendor_id` **or admin** |
| **profiles** | own row (`id = auth.uid()`) **or admin** (admin may read any profile for the management console) | own row only, and only with `role` matching signup (never `admin` — see §3 guard); insert normally via trigger. **Admins** may also INSERT a profile if ever needed (admin-only policy), though the normal path is the trigger | own row **or admin**; the role/ownership column guard blocks a non-admin from changing `role`, but **permits an admin** to change another user's `role`/ownership (the management capability — see note) | own row **or admin** (own = account-deletion path; admin = moderation) |
| **orders** | student sees own (`student_id = auth.uid()`); vendor sees orders for vendors they own; **admin sees all** | **none from client** (only the C# service inserts — admins included) | **none from client** (only the C# service transitions status — admins included) | none |
| **order_items** | visible if parent order is visible (student owns it, or vendor owns the order's vendor) **or admin** | none from client (C# service only) | none | none |
| **reviews** | anyone (reviews are public on the store page) | student only; `WITH CHECK (student_id = auth.uid() AND EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.student_id = auth.uid() AND o.status = 'completed'))` (admins do not author reviews) | author (`student_id = auth.uid()`) **or admin** | author **or admin** (admin delete = moderation) |
| **favorites** | own rows (`student_id = auth.uid()`) **or admin** (see note) | own rows only | — | own rows **or admin** (see note) |

Notes and rationale:

- **vendors INSERT from client = admin only (ordinary clients none).** A new vendor row for a self-signed-up vendor is still created by the **signup trigger** (see Auth), running `security definer` with `owner_id = new user`, so a student can never self-insert a vendor row to escalate. The additional **admin-only INSERT policy** lets an admin create a store row directly from the management console if needed (rare — most stores already exist from the seed). If a self-signup vendor supplied a `store` name (`Signup.jsx:18,64-71`), the trigger also creates the `vendors` row.
- **vendors UPDATE restricts columns, and the column guard knows about admins.** RLS can't restrict columns directly, so a **BEFORE UPDATE trigger** (`guard_vendor_columns`) rejects changes to `owner_id`, `rating`, `review_count` from non-service connections.

  **Service-role exemption — the trigger's FIRST check, before any role logic (resolves the Rev-4 HIGH finding).** A `BEFORE UPDATE` trigger fires for **every** writer, including the service-role / seed / `postgres` connection — RLS-bypass is **not** trigger-bypass. So the guard must *explicitly* short-circuit for the privileged connection before it ever evaluates `public.auth_role()` (which, on a service connection where `auth.uid()` is NULL, returns NULL = "not admin, not owner" and would otherwise wrongly block the seed script). The trigger body therefore opens with:
  ```sql
  -- first lines of guard_vendor_columns():
  IF current_setting('request.jwt.claims', true) IS NULL          -- AUTHORITATIVE: no PostgREST/GoTrue JWT context
     OR current_user IN ('postgres','supabase_admin','service_role') THEN  -- belt-and-suspenders (names confirmed in Phase A)
    RETURN NEW;  -- service-role / direct DB (seed script, migrations): unguarded
  END IF;
  ```
  **Which half of that `OR` is load-bearing (resolves the current NIT on the role-name list).** The **authoritative** test is the first operand — `current_setting('request.jwt.claims', true) IS NULL`, i.e. "there is no PostgREST/GoTrue JWT context." A seed-script / SQL-editor / Npgsql connection carries no `request.jwt.claims` GUC, so that operand alone exempts it; a browser caller always arrives through PostgREST/GoTrue with the GUC set, so it is always guarded. The `current_user IN ('postgres','supabase_admin','service_role')` operand is a **secondary belt-and-suspenders check, not a dependency**: the exact role name of the seed/service connection is environment-dependent (it may be `postgres`, a pooler tenant role, or something else depending on whether the seed connects via the pooler, a direct DB connection, or the SQL editor), so **this list is not relied upon for correctness and its membership is confirmed against the real project in Phase A** — the Phase A checklist prints `current_user` from the seed connection and adds it to the list if it differs. The design does **not** assume the enumerated names are complete; the `request.jwt.claims IS NULL` operand is the guarantee, and the role list only hardens the (unlikely) case where a future Supabase change set a JWT-claims GUC on a service connection.
  Only **after** this early return does the trigger apply the admin branch and the client column restrictions below. This is the exempt path under which **the §5 seed-script `UPDATE` of `rating`/`review_count`/`owner_id` runs** (it connects as the service role, so `request.jwt.claims` is unset / `current_user` is a service role → `RETURN NEW` → all columns writable). The C# order service never updates `vendors`, so it is unaffected either way; the general claim "the service-role path is unaffected" is now true *by construction* (the explicit exemption), not by accident. **The `profiles` role-immutability guard carries the identical first-check block**, so the Change-1 admin bootstrap `UPDATE public.profiles SET role='admin' …` (run in the SQL editor as the service/owner role) is likewise exempt and succeeds. **Change 1 exception (client path):** after the service early-return, for a browser caller the trigger checks `public.auth_role() = 'admin'` (evaluated via the same `SECURITY DEFINER` helper) and, for an admin caller, **allows** `owner_id` to change (this is the admin dashboard's "assign/change owner" = claim-management tool, Change 2) and `preorder_enabled`/store-info edits; it still blocks direct writes to the denormalized `rating`/`review_count` for everyone (those are trigger-maintained) — an admin has no legitimate reason to hand-edit the aggregates. So: owner (non-admin) → may edit info/hours/preorder/logo/cover only; admin → may additionally re-point `owner_id`; nobody (client-side) → may write `rating`/`review_count`. The owner-or-admin `USING`/`WITH CHECK` clause gates which rows are updatable; the trigger gates which columns. This maps to the dashboard's `updateVendorInfo`/`setPreorderEnabled` surface (`VendorContext.jsx:90-99`) for vendors and the admin console's assign-owner/toggle-preorder/edit-store actions (§3) — the admin reuses the same `update` **shape** but parameterized by the selected vendor's `id`, not the vendor-only `currentVendorId` (see §5(a)).
- **profiles UPDATE column guard knows about admins too.** The existing role-immutability guard (a `BEFORE UPDATE` trigger on `profiles`) blocks a user from changing their own `role` after creation. **Like `guard_vendor_columns`, its first lines are the same service-role early-return** (`IF current_setting('request.jwt.claims', true) IS NULL OR current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;`), so a direct DB / service-role statement — the manual `UPDATE public.profiles SET role='admin' …` admin bootstrap (§3) and any seed write — bypasses the guard entirely and is never evaluated against `public.auth_role()`. Only after that early return does Change 1 relax the guard **for an admin browser caller**: when `public.auth_role() = 'admin'`, the trigger permits `role` (and, on `vendors`, `owner_id`) changes so the admin can, e.g., promote/demote a user or reassign a store. A non-admin changing their own `role` is still rejected (anti-escalation). The guard distinguishes the caller purely by the service early-return then `public.auth_role()`, never by trusting a client-sent flag.
- **Admin never gains order WRITE from the browser.** The admin's `orders`/`order_items` access is SELECT-all for the read-only cross-vendor order view; INSERT/UPDATE stay "none from client" for admins exactly as for everyone, because order creation and status transitions remain the C# service's responsibility (Model 2 invariant). If an admin ever needs to force a status change, that is a future service capability, not a direct RLS write.
- **orders/order_items INSERT+UPDATE = none from client** is the crux of Model 2: the browser can only *read* orders; all writes go through the C# service (service-role). This guarantees server-side price/total computation and status-lifecycle enforcement can't be bypassed.
- **reviews INSERT gated on a completed, owned order** turns the fake `PENDING_REVIEWS` flow into a real rule: you may review only an order you actually completed. The `WITH CHECK` is `student_id = auth.uid() AND EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.student_id = auth.uid() AND o.status = 'completed')`. Because `reviews.order_id` is `NOT NULL` and the `(student_id, vendor_id, order_id)` unique key is NULL-free, each completed order yields at most one review.

  **Client review-submit flow (concrete).** Two existing screens drive the insert, both of which already have a completed order in hand:
  - `OrderStatus.jsx` — the completed state's "Leave a review" button, whose `onClick` is currently an empty `/* TODO: open your review modal / route here */` stub (confirmed in source). It opens a rating+text form; the completed order's UUID is the `order.id` already loaded on that page.
  - `Profile.jsx` — the `PENDING_REVIEWS` list (student's completed-but-unreviewed orders). Each entry carries its order UUID and the order's `vendor_id`.

  The insert payload is exactly:
  ```js
  await supabase.from('reviews').insert({
    vendor_id,      // the completed order's vendor_id
    order_id,       // the completed order's UUID (from order.id)
    rating,         // 1..5 from the form
    text,           // optional free text
  })
  // student_id       -> omitted; filled by DEFAULT auth.uid()
  // author_name      -> omitted; overwritten by the set_review_snapshot trigger from profiles.full_name
  // ordered_summary  -> omitted; overwritten by the set_review_snapshot trigger from order_items
  ```
  The client never sends `student_id` (column default `auth.uid()`), `author_name`, or `ordered_summary` (both trigger-filled, un-spoofable). `order_id` is always the completed order's UUID carried from the order record the screen is showing; RLS rejects the insert if that order is not a `completed` order owned by the caller, so an attacker cannot fabricate a review for an order they do not own.
- **order_items SELECT stays private (no public policy).** The restrictive "visible only if the parent order is visible" policy is deliberately kept; it is **not** loosened to let the public store page read reviewed orders' line items. The public store page never touches `order_items` for reviews — it reads the `reviews.ordered_summary` snapshot column (§1) instead. This avoids disclosing other students' item names, quantities, and prices to anonymous visitors, which a public order_items read policy would have leaked. The earlier plan to derive the `ordered` string by joining `order_id → order_items` at read time is **replaced** by the insert-time snapshot precisely because that join is unreadable for the store page's anonymous / non-owner audience.
- **profiles SELECT = own row only (plus admin); no public read.** The store/reviews UI shows a reviewer's display name via the `reviews.author_name` snapshot column (§1), which the `set_review_snapshot` trigger fills from `profiles.full_name` at insert time. This keeps emails/mobiles private — there is no public policy on `profiles`. A student reads only their own profile row; a vendor reads only their own profile row; **an admin reads any profile row** (`public.auth_role() = 'admin'`) so the management console can resolve owner names/emails when assigning a vendor's owner. Admin profile reads are still a logged-in, role-gated path (no anonymous exposure).
- **Admin `favorites` SELECT/DELETE is forward-looking, not backed by a current dashboard surface.** The §5 admin console has no favorites panel (it manages vendors, moderates reviews, and reads orders only), so the admin SELECT/DELETE grant on `favorites` has **no current feature behind it**. It is kept deliberately for symmetry with the other content-table admin grants and for a **future user-management view** (e.g. inspecting or clearing a user's favorites during account cleanup); it exposes no new data path today (admins are already logged-in, role-gated) and is harmless until such a surface exists. Flagged here so the grant's intent is explicit rather than accidental. **On the `—` in the `favorites` UPDATE column (resolves the Rev-4 NIT):** `favorites` has **no UPDATE policy for anyone — admin included** — because the row is a pure membership tuple `(student_id, vendor_id, created_at)` with nothing mutable (a change of favorite is a DELETE + INSERT, not an UPDATE). So the admin grant on `favorites` is **SELECT/DELETE only**, matching the `—`; no UPDATE grant was forgotten.

Anonymous (not logged in) users: can SELECT `categories`, `location_areas`, `vendors`, `menu_items`, `reviews` — exactly the browse experience of Home/Search/VendorStore. They cannot read orders/favorites/profiles and cannot write anything. This replaces today's "everyone sees everything from a JS array".

---

## 3. Auth flow

### Signup

The existing `Signup.jsx` already has a role radio group (`student` / `vendor`, lowercase — `role` is a separate `useState`, not part of `form`) and a `form` state of exactly `{ name, email, phone, password, store }` (`Signup.jsx:18`; `store` shown only for vendors). The rewrite keeps this UI and swaps the fake `goNext()` for a real call.

**Form-field → `user_metadata` key mapping (pinned — do not rename at will).** The form fields are `name`, `phone`, `store`; the metadata keys the trigger reads are `full_name`, `mobile`, `store_name`. The signup call makes the rename explicit so no value is silently dropped:

```js
// Signup.jsx submit handler (replaces goNext())
await supabase.auth.signUp({
  email: form.email,
  password: form.password,
  options: {
    data: {
      full_name:  form.name,                               // form field `name`  -> metadata key `full_name`
      role,                                                // 'student' | 'vendor' (the role useState)
      mobile:     form.phone,                              // form field `phone` -> metadata key `mobile`
      store_name: role === 'vendor' ? form.store : null,   // form field `store` -> metadata key `store_name`
    },
  },
})
```

1. `supabase.auth.signUp(...)` as above. The chosen `role`, full name, mobile, and (for vendors) store name ride along in `user_metadata` via `options.data` under the keys `full_name`/`role`/`mobile`/`store_name`.
2. A Postgres trigger **`on auth.users insert`** (`handle_new_user`, `security definer`) creates the matching `public.profiles` row, reading **exactly** `new.raw_user_meta_data->>'full_name'`, `->>'role'`, and `->>'mobile'` (and `->>'store_name'` for vendors). These key names must match the `options.data` keys above verbatim — a mismatch (e.g. reading `'phone'` when the client sent `'mobile'`) silently stores NULL into `profiles.mobile`.

   **Privilege-escalation guard (Change 1) — the trigger must never accept `admin` from client metadata.** The `role` comes from client-supplied `raw_user_meta_data->>'role'`, which a crafted `signUp` call could set to `'admin'`. The trigger therefore **coerces any role that is not exactly `'vendor'` to `'student'`** before inserting the profile — i.e. `role := CASE WHEN raw_user_meta_data->>'role' = 'vendor' THEN 'vendor' ELSE 'student' END`. This whitelists the only two self-service roles and makes `admin` (or any unknown string) impossible to obtain via signup; it is a coerce-to-student, not an error, so a malformed client cannot even register as the default. (Belt-and-suspenders: the profiles role-immutability guard then prevents a later self-promotion, and `admin` can only be set by a privileged DB statement — see "Creating an admin" below.)

   If the (coerced) `role = 'vendor'`, the trigger also inserts a `vendors` row with `owner_id = new.id`, `name = raw_user_meta_data->>'store_name'`, the slug `id` (see the slug rule below), and defaults for every other `NOT NULL` column: `preorder_enabled = false`; `hours_open`/`hours_close` take their `'00:00'` column default; and **`category`/`location_area` take their `'uncategorized'`/`'unassigned'` column defaults** (all per §1) — so the trigger's minimal INSERT never lists those columns and never hits a `NOT NULL`/FK violation. Real values are set afterward (the vendor dashboard for self-signup, the §5 seed-script `UPDATE` for seed accounts).

   **Vendor slug `id` — rule (resolves the under-specified fallback). The branch is selected by the CALLER, not by a client-supplied flag (resolves Rev-4 review Finding 1).** The authoritative test is whether the insert runs on the service connection or a JWT-bearing browser connection, using the same `current_setting('request.jwt.claims', true) IS NULL` check already established in §2 (NULL claims ⇒ service/seed connection; non-NULL ⇒ a logged-in browser caller). The trigger therefore honors `store_slug` **only** for the no-JWT service connection:
   - **Service/seed connection (`request.jwt.claims` IS NULL):** if `raw_user_meta_data->>'store_slug'` is present (the Change-2 seed script sends it — §5), use it verbatim as `vendors.id`, preserving the canonical seed slugs (`tita-nenas`, …) that routes/cart key on (§1).
   - **Any JWT-bearing (browser) caller — i.e. every real self-signup:** `store_slug` is **ignored entirely**, even if a crafted `signUp` payload includes it. The trigger always mints the slug from the store name with a defined slugify function: `lower(regexp_replace(raw_user_meta_data->>'store_name', '[^a-z0-9]+', '-', 'gi'))`, trimmed of leading/trailing `-`. On a slug collision with an existing vendor (including a canonical seed slug), it appends `-2`, `-3`, … (the trigger loops until the id is free) so the id is always unique and the store is always created. A browser signup therefore can neither target a seed slug nor end up store-less, regardless of what metadata it sends.

   **Conflict handling follows the same caller test, so a self-signup vendor is never silently left store-less.** The service/seed path uses `INSERT ... ON CONFLICT (id) DO NOTHING` because re-running the seed must be idempotent and the seed script owns the slug — a conflict there means "already seeded", which is the safe outcome. The browser self-signup path does **not** use `DO NOTHING`: because the slugify step above already guarantees a unique id (it appends a numeric suffix on collision), the plain `INSERT` cannot conflict, and if it somehow did (a genuinely unexpected race) it raises rather than silently skipping — so a self-signup vendor always gets exactly one store row or a surfaced error, never a silent no-store. Because `DO NOTHING` is reachable only on the no-JWT connection, a browser caller can never reach the silent-skip branch. See §5 for how the seed ordering relies on the service-connection `store_slug`/`DO NOTHING` branch.
3. The role is thereby **stored in `profiles.role`** (the source of truth) and optionally **mirrored into the JWT** via a custom access-token hook or by setting `app_metadata.role` in the trigger. **Decision:** store role in `profiles` AND mirror it into `app_metadata` so the C# service can read role from the JWT without a DB round-trip, while RLS policies read it from `profiles` (authoritative). The mirror is written by the trigger; `app_metadata` is not user-writable, so it's safe.

**How a vendor account gets the vendor role — decision and justification:** vendor role is chosen **at signup via the vendor signup path** (the existing role switch), self-provisioning the vendor profile + store row through the `security definer` trigger. An admin (Change 1) can additionally reassign store ownership after the fact (the "claim" tool), but a vendor does **not** need admin approval to exist. The trade-off (anyone can self-register as a vendor) is acknowledged in Open Questions Q1; the admin console now provides a moderation lever (an admin can delete/unassign an abusive store) that did not exist when "no admin" was assumed.

### Creating an admin (Change 1 — manual DB assignment only)

There is **no admin signup path and no admin radio on the Signup form** — the role switch in `Signup.jsx` stays **student/vendor only** (verified: `Signup.jsx:17` initializes `role` from `?role=vendor` else `'student'`, and the `role-switch` radiogroup at `Signup.jsx:46-57` renders exactly two buttons — Student (`setRole('student')`) and Vendor (`setRole('vendor')`); no third option is added). An admin is created by one of:

- **Promote an existing account:** sign up normally (as student or vendor), then in the Supabase SQL editor / `psql` run `UPDATE public.profiles SET role = 'admin' WHERE id = '<auth-user-uuid>';` (or filter by `email`). Because this statement runs as the Postgres owner / service role, it hits the profiles role-guard's **service-role early-return** — whose **authoritative** condition is `current_setting('request.jwt.claims', true) IS NULL` (no PostgREST/GoTrue JWT context; the `current_user IN (...)` list is only the belt-and-suspenders secondary check confirmed in Phase A, §2) → `RETURN NEW` — and so is **never** evaluated against `public.auth_role()`; the guard does not block it. (The guard only constrains client/anon/auth connections, which always carry a JWT-claims GUC.) The admin RLS policies then apply on that user's next session.
- Optionally mirror the role into `app_metadata` for the one admin (`auth.admin.updateUserById` with `app_metadata: { role: 'admin' }`) if a service ever needs to read admin-ness from the JWT; not required for the dashboard, which reads `profiles.role`.

This manual-only path is the deliberate escalation boundary: `admin` can never be obtained through the public signup API (the trigger coerces it away, step 2), only by someone with direct DB / service-role access. The getting-started / phased plan (§6/§7) documents the exact `UPDATE` statement as the one-time bootstrap step for the first admin.

### Login

`supabase.auth.signInWithPassword({ email, password })`. Supabase returns a session (access + refresh JWT) persisted by `@supabase/supabase-js` (localStorage by default). On success, fetch the caller's `profiles` row to get `role`/`full_name`/`avatar_url`/`mobile` for the header and profile UI.

### Session handling in React

`AuthContext.jsx` is rewritten to wrap the Supabase client:

- On mount: `supabase.auth.getSession()` to hydrate; subscribe to `supabase.auth.onAuthStateChange` to keep `user` in sync across tabs and token refreshes.
- `user` shape becomes `{ id, email, role, full_name, mobile, avatar_url }` sourced from `profiles` (not the ad-hoc `{ name, email, role: 'Student' }` object). **Normalization note:** the current code is inconsistent — `AuthContext`/`Header` use capitalized `'Student'`/`'Vendor'` (`AuthContext.jsx:11,33`, `Header.jsx:18`), while `Signup.jsx` uses lowercase `'student'`/`'vendor'`. The DB enum is **lowercase**; the rewrite standardizes on lowercase everywhere and updates `Header.jsx:18` (`profilePath` check) and `Cart.jsx:23` (`user?.role === 'Student'`) accordingly.
- `login`, `logout` call Supabase; `updateUser` updates the `profiles` row (replacing the per-keystroke localStorage write). `changePassword` → `supabase.auth.updateUser({ password })` (replacing the "not available yet" stub at `AuthContext.jsx:47-49`; the sibling `deleteAccount` stub is at `AuthContext.jsx:51-53`). `deleteAccount` → there is no client-side user-delete in Supabase; **Decision:** account deletion requires the service-role, so it is NOT part of the narrow order service's mandate and NOT doable from the client. Recommend a tiny separate `security definer` RPC or deferring deletion (Open Questions Q5). Until then `deleteAccount` keeps throwing a clear "not available yet" error — this is honest, unlike the original silent no-op flagged as audit finding C3.
- `DEMO_MODE`, `DEMO_STUDENT`, `readUser()` localStorage shim are deleted.

### Role-gated routes (replacing DEMO_MODE / PREVIEW_USER)

Introduce route guards in `App.jsx`. **Decision:** add two wrapper components, `RequireAuth` (any logged-in user) and `RequireRole({ role })`, implemented with react-router's `<Navigate>` and the `useAuth()` session:

- While the session is still loading, render a lightweight splash (avoid redirect flicker before `getSession()` resolves).
- `/profile` → `RequireRole role="student"` (student-only). Removes `PREVIEW_USER` (`Profile.jsx:17`) and restores the redirect that is commented out at `Profile.jsx:734` (`// if (!auth.user) return <Navigate to="/login" replace />`).
- `/dashboard` → `RequireRole role="vendor"` (vendor-only).
- `/admin` → `RequireRole role="admin"` (admin-only) — the new admin dashboard surface (§5). A non-admin (student, vendor, or anonymous) hitting `/admin` is redirected exactly as the other role-gated routes are. This route is added to the `<Routes>` block in `App.jsx` (`App.jsx:40-50`, which today lists `/`, `/search`, `/vendor/:id`, `/cart`, `/order/:id`, `/profile`, `/dashboard`, `/login`, `/signup`, `*`) as `<Route path="/admin" element={<RequireRole role="admin"><Admin /></RequireRole>} />`, with a new `Admin` page import alongside the existing page imports.
- `/cart`, `/order/:id` → `RequireAuth` (must be a logged-in student to place/track an order).
- `/`, `/search`, `/vendor/:id`, `/login`, `/signup` → public.
- `Header.jsx` nav drops the "frontend preview only" always-visible `/profile` link (`Header.jsx:55-60`) and shows profile vs. dashboard based on the real `role`. **Admins** see an **Admin** nav link (to `/admin`): `profilePath` (`Header.jsx:18`, currently `user?.role === 'Vendor' ? '/dashboard' : '/profile'`) is extended to `role === 'admin' ? '/admin' : role === 'vendor' ? '/dashboard' : '/profile'` (also switching to the lowercase-canonical role per §3), so both the primary "My profile" `NavLink` (`Header.jsx:50-53`) and the profile-chip (`Header.jsx:71-78`) point an admin at `/admin`. The hard-coded "Vendor Dashboard" `NavLink` (`Header.jsx:46-48`) becomes role-conditional: "Vendor Dashboard" for vendors, "Admin" for admins, hidden for students/anonymous.

The guards consult only `useAuth()` session state; final enforcement is still RLS (client) and JWT checks (C# service), so a forged client route can't actually read/write protected data.

---

## 4. C# order service design

### Scope

One ASP.NET Core Web API (Minimal APIs) with exactly two capabilities: **place an order** and **transition an order's status**. Everything else stays client↔Supabase.

### Project location and layout

Decision: place the service in a sibling folder `server/FoodHerons.Api/` inside the repo (monorepo) so frontend and backend version together.

```
server/
  FoodHerons.Api/
    FoodHerons.Api.csproj        (net10.0)
    Program.cs                   (Minimal API host, auth, DI)
    Endpoints/OrdersEndpoints.cs
    Dtos/ (PlaceOrderRequest, PlaceOrderResponse, LineItemDto, TransitionRequest, OrderDto)
    Services/OrderService.cs     (price validation, total computation, status rules)
    Data/Db.cs                   (Npgsql connection factory)
    Auth/SupabaseJwt.cs          (JWT bearer config)
    appsettings.json             (non-secret config only)
  FoodHerons.sln
```

`.gitignore` adds `bin/`, `obj/`, and any `server/**/.env`.

### Endpoints, routes, DTOs

Base path `/api`. All endpoints require a valid Supabase JWT (`Authorization: Bearer <access_token>`).

**POST `/api/orders`** — place an order.

Request `PlaceOrderRequest`:
```
{
  "vendorId": "tita-nenas",
  "pickupName": "Juan Dela Cruz",
  "note": "extra sauce",
  "items": [ { "menuItemId": "tapsilog", "qty": 2 }, { "menuItemId": "iced-tea", "qty": 1 } ]
}
```
The client sends **only item ids and quantities** — never prices. (This is the key change from `Cart.jsx:30-44`, whose `placeOrder` built the whole order incl. prices client-side and wrote it to `sessionStorage` at `:43`.)

Response `PlaceOrderResponse` (201):
```
{ "id": "<uuid>", "code": "FH-000142", "status": "pending", "subtotal": 175.00, "total": 175.00,
  "vendorId": "tita-nenas", "items": [ { "menuItemId":"tapsilog","name":"Tapsilog","unitPrice":75.00,"qty":2 }, ... ],
  "placedAt": "..." }
```

**POST `/api/orders/{id}/transition`** — advance/cancel status.

Request `TransitionRequest`: `{ "to": "preparing", "reason": null }` (`reason` required when `to = cancelled`).
Response `OrderDto` (200) with the new status + timestamps.

**GET `/api/orders/{id}`** (optional convenience) — returns the order for the authorized caller. May be omitted if the client reads orders directly via Supabase RLS (preferred, to keep the service narrow). **Decision:** omit GET from the service; reads go direct-to-Supabase under RLS. The service is write-only.

### Status lifecycle and authorization rules

Valid forward transitions (mirrors `Dashboard.jsx` `STATUS_ORDER` and `ACTION`):

```
pending   → preparing  (vendor accepts)            [student may: cancel]
preparing → ready       (vendor marks ready)
ready     → completed   (vendor hands over)
pending   → cancelled   (student cancels while pending, OR vendor rejects with reason)
preparing → cancelled   (vendor rejects with reason)
```
Rejected: any backward move, any skip (e.g. pending→ready), any transition out of a terminal state (`completed`, `cancelled`). Note the frontend uses `preparing` where `OrderStatus.jsx` STEPS say `accepted`; the DB/service canonical term is **`preparing`**, and the student tracker maps `preparing → "Accepted"` label. This reconciles `Dashboard.jsx` (`preparing`) with `OrderStatus.jsx` (`accepted`).

**Concurrency / tie-break (student cancel vs vendor accept).** Every transition is atomic: the service opens a transaction and reads the order's current status with `SELECT ... FOR UPDATE` before applying the change, so a student cancel and a vendor accept cannot both win. A **student cancel is accepted only if the current status is still `pending`**; if the vendor has already moved the order to `preparing`, the student cancel loses the race and returns `409 ILLEGAL_TRANSITION`. This makes Open Question 3's "student may cancel only while pending" an enforced rule rather than an advisory one.

Authorization per operation:
- **Place order:** caller JWT `sub` must be a `student`. The order's `student_id` is forced to the caller's uid (never taken from the body). Vendor must have `preorder_enabled = true` and be currently open — otherwise 409. **Openness is evaluated in `Asia/Manila` (UTC+8, no DST):** the service converts `DateTimeOffset.UtcNow` to the `Asia/Manila` zone, formats to `HH:mm`, and compares against `hours_open`/`hours_close`, mirroring the overnight-wrap logic of `isOpenNow()` (when `hours_close < hours_open` the open window spans midnight, so "open" means `now >= hours_open OR now < hours_close`; otherwise `hours_open <= now < hours_close`). Evaluating in UTC would mis-judge openness because the stored hours are PH wall-clock; the client bug is invisible today only because browsers run in PH local time.
- **Transition:** for vendor transitions (`→preparing/ready/completed`, vendor reject), caller must be the **owner of the order's vendor** (`vendors.owner_id = caller uid`). For student cancel (`pending→cancelled`), caller must be the order's `student_id`. Anyone else → 403.

### JWT validation approach

Supabase issues HS256 JWTs signed with the project's JWT secret (legacy) — and newer projects support asymmetric (RS256/ES256) signing keys exposed via JWKS at `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`.

**Decision:** configure `JwtBearer` to validate against the **JWKS endpoint** (asymmetric) when the project uses signing keys, falling back to the **shared HS256 secret** otherwise. Validate `issuer = https://<project>.supabase.co/auth/v1`, `audience = "authenticated"`, signature, and expiry. The user confirms which signing mode their ready project uses during Phase C (Open Questions Q6). Read `sub` (= auth user id) and `app_metadata.role` from validated claims. No DB round-trip needed for identity; the service still queries the DB to confirm vendor ownership for transitions.

### Service-role usage and DB connection

The service connects to Postgres via **Npgsql** using the **service-role connection string** (the pooled Postgres connection from Supabase → Settings → Database, using the `postgres` or service role). Because this connection is not an RLS-subject role, the service can INSERT orders/order_items and UPDATE order status despite the client-side "none" policies. The service NEVER accepts a price from the client: it `SELECT`s `price`, `name`, `available` from `menu_items` for each `(vendor_id, menuItemId)`, rejects unknown/unavailable items (422), computes `unit_price * qty` summed = `subtotal = total`, assigns `code` from the `order_code_seq` sequence (`'FH-' || lpad(nextval(...)::text, 6, '0')` — no retry loop, collisions are impossible), and writes `orders` + `order_items` in a single transaction.

Alternative considered: have the service call back into Supabase via PostgREST with the service-role **key** (not a DB connection). Rejected for the privileged writes because a direct Npgsql transaction gives atomic multi-row insert and server-side total computation in one round-trip, and avoids coupling to PostgREST semantics. The service-role **key** is still relevant for any admin REST call but isn't needed here.

### Config / secrets (service)

Non-secret (`appsettings.json`): `Supabase:Url`, `Supabase:Issuer`, `Supabase:Audience`.
Secret (user-secrets in dev, environment variables in prod — never committed):
- `Supabase__ServiceRoleKey` (if any REST admin call is used)
- `Supabase__JwtSecret` (HS256 mode) and/or JWKS fetched from URL (asymmetric mode)
- `ConnectionStrings__Postgres` (the service-role DB connection string, incl. password)

Dev uses `dotnet user-secrets` (stored outside the repo). An `appsettings.Development.json` with placeholders is committed; real values are not.

### How React calls the service

The client posts to the API with the current Supabase access token in the `Authorization` header. **Decision:** in dev, add a Vite proxy so the frontend calls a same-origin relative path and avoids CORS:

```
// vite.config.js server.proxy
'/api': { target: 'http://localhost:5080', changeOrigin: true }
```

In production the API base URL comes from `VITE_API_BASE_URL` (default `/api`). The service also enables CORS for the frontend origin as a backstop. `Cart.jsx`'s `placeOrder` is rewritten to `POST /api/orders` and navigate to `/order/{id}`; `OrderStatus.jsx` reads the order via Supabase (RLS) and the student-cancel button calls `POST /api/orders/{id}/transition`; `Dashboard.jsx` action buttons call the same transition endpoint.

### Error handling (per operation)

| Operation | Failure condition | Recoverable? | Caller receives | Logged? |
| --- | --- | --- | --- | --- |
| Place order | Missing/invalid JWT | recoverable (re-login) | 401 | info |
| Place order | Caller not a student | fatal for request | 403 | warn |
| Place order | Empty `items` / qty ≤ 0 | recoverable (fix cart) | 422 + field detail | info |
| Place order | Unknown or unavailable menu item | recoverable | 422 `{ code: "ITEM_UNAVAILABLE", menuItemId }` | info |
| Place order | Vendor not accepting / closed | recoverable | 409 `{ code: "VENDOR_CLOSED" }` | info |
| Place order | DB transaction failure | retryable | 500 (generic) | error (with trace id) |
| Transition | Invalid JWT | recoverable | 401 | info |
| Transition | Order not found | fatal | 404 | info |
| Transition | Caller not owner/student | fatal | 403 | warn |
| Transition | Illegal transition (skip/backward/terminal) | fatal | 409 `{ code:"ILLEGAL_TRANSITION", from, to }` | info |
| Transition | Cancel without reason | recoverable | 422 | info |
| Any | Unhandled exception | — | 500 + correlation id | error |

All 5xx responses return a generic body plus a correlation id; stack traces are logged, never returned. Validation (422/409) returns a machine-readable `code` so the UI can show the right message (e.g. re-enable the cart item). Logging via `ILogger` at the stated levels; no PII (names, emails) in logs beyond the order `code` and user id.

### Input validation (each external input)

- `vendorId` (string, required): must exist and be `preorder_enabled`. Fail → 422/409.
- `pickupName` (string, required, **2–80 chars after trim**): empty or whitespace-only is rejected with 422; a single character is also rejected (a pickup name shorter than 2 chars is treated as invalid). The service does **not** fall back to the student's profile name — the client must supply a valid pickup name. Fail → 422.
- `note` (string, optional, ≤ 280 chars): trimmed; over-length → 422.
- `items` (array, required, 1–50 entries): each `menuItemId` non-empty string, `qty` integer 1–99. Duplicate ids are merged (summed). Fail → 422.
- `to` (enum, required): must be a member of `order_status`. Fail → 422.
- `reason` (string, required iff `to = cancelled`, ≤ 140 chars): else 422.

### Invariants and which layer owns them

| Invariant | Owning layer | Why |
| --- | --- | --- |
| Order total == sum(unit_price*qty), prices from DB | C# service | only place with service-role + trusted price source; client can't be trusted |
| Only the ordering student places their order | C# service (JWT) + RLS read | write path is service-only; forces `student_id = caller` |
| Only the owning vendor transitions status | C# service (JWT + ownership query) | ownership is a DB fact; checked in the privileged write |
| Legal status lifecycle | C# service | single writer can enforce a state machine atomically |
| Vendor edits only their own store/menu | RLS (`owner_id = auth.uid()`) + column trigger (`guard_vendor_columns`, with a service-role early-return so seed/service writes are unguarded — §2) | direct client writes; DB is the only enforcement point |
| Review only a completed, owned order | RLS `WITH CHECK` | direct client insert |
| One role per account; role immutable by the owner, changeable only by an admin or the DB | signup trigger (coerces client role to student/vendor, never admin) + profiles update trigger (blocks self role-change, permits admin role-change) | role set once at self-provisioning; `admin` set only by a privileged DB statement; admin may re-role others |
| Denormalized `vendors.rating`/`review_count` | DB trigger on `reviews` insert/delete | keep aggregates consistent regardless of writer |

---

## 5. Seed-data migration plan

### Hardcoded content → SQL seed migration

A seed migration (`supabase/migrations/NNNN_seed.sql`, or `supabase/seed.sql`) inserts:
- `categories`: the 6 rows from `vendors.js:5-12` (`rice/snacks/drinks/desserts/noodles/grill` with `name` + `image`), plus `sort_order`.
- `location_areas`: the 6 values from `vendors.js:14-21` (`Main Gate`, `HPSB Building`, `Admin Lobby`, `Covered Court`, `Food Court`, `Back Gate`), each seeded as a row with `id = name = <value>` and an incrementing `sort_order`. This is where the `locationAreas[]` array is re-homed once `src/data/vendors.js` is deleted in Phase B — the fixed location-filter list is sourced from this table thereafter, not from a frontend constant.
- **Seed vendor demo accounts (Change 2) — created FIRST, before the vendor rows.** Each of the 8 seed vendors gets a real Supabase auth user as its owner, using a **fake/placeholder email** so every seed store has a working vendor login for demos. **Mechanism — decision:** create these via the **Supabase service-role Admin API from a seed script** — specifically `supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name, role: 'vendor', store_name } })` run with the service-role key (equivalently the `supabase` CLI / Management API). This is chosen over a raw `INSERT INTO auth.users` because Supabase does not support reliably inserting auth users by plain SQL (password hashing, identities, and internal columns are managed by GoTrue); `admin.createUser` is the supported, idempotent-enough path. Each account uses email `<vendor-slug>@foodherons.local` (e.g. `tita-nenas@foodherons.local`, `campus-brews@foodherons.local`, … `rice-rush@foodherons.local`), `email_confirm: true` (so no inbox is needed for the fake domain), and metadata `role: 'vendor'` + `store_name` = the store's display name + `store_slug` = the canonical slug + `full_name` = the store's demo owner name (table below). Because `role: 'vendor'` is in metadata, the `handle_new_user` signup trigger (§3) provisions the matching `profiles` row **and** attempts to create the `vendors` row from `store_name`.

  **Why the fake domain works (resolves the Rev-4 MEDIUM finding, part b).** GoTrue validates an email's **syntactic shape**, not its deliverability; `<slug>@foodherons.local` is a well-formed address (`.local` is a syntactically valid TLD), so `createUser` accepts it. Passing `email_confirm: true` marks the address confirmed at creation, so GoTrue never attempts to send — or require the user to click — a confirmation link, which is exactly what makes the unroutable `.local` domain usable for a login-only demo account.

  **The 8 demo `full_name` values — specified explicitly (resolves the Rev-4 MEDIUM finding, part a).** `profiles.full_name` is `NOT NULL` and the `set_review_snapshot` trigger copies it into `reviews.author_name`, so these are UI-visible and must be deterministic, not implementer-invented. Each demo owner's `full_name` is `"<Store display name> (Demo Owner)"` — derived mechanically from the store name so the seed is reproducible and the "(Demo Owner)" suffix makes any demo-authored review obviously non-real:

  | slug | email | store_name (display) | full_name |
  | --- | --- | --- | --- |
  | `tita-nenas` | `tita-nenas@foodherons.local` | Tita Nena's Silog | Tita Nena's Silog (Demo Owner) |
  | `campus-brews` | `campus-brews@foodherons.local` | Campus Brews | Campus Brews (Demo Owner) |
  | `crunch-corner` | `crunch-corner@foodherons.local` | Crunch Corner | Crunch Corner (Demo Owner) |
  | `noodle-house` | `noodle-house@foodherons.local` | Ate Len Noodle House | Ate Len Noodle House (Demo Owner) |
  | `sweet-spot` | `sweet-spot@foodherons.local` | The Sweet Spot | The Sweet Spot (Demo Owner) |
  | `smoky-grill` | `smoky-grill@foodherons.local` | Kuya Boy Smoky Grill | Kuya Boy Smoky Grill (Demo Owner) |
  | `brekkie-cart` | `brekkie-cart@foodherons.local` | Brekkie Cart | Brekkie Cart (Demo Owner) |
  | `rice-rush` | `rice-rush@foodherons.local` | Rice Rush | Rice Rush (Demo Owner) |

  (The `store_name` display values mirror `src/data/vendors.js` **verbatim** — each is the store's exact `name` from that file: `Tita Nena's Silog` (`vendors.js:26`), `Campus Brews`, `Crunch Corner`, **`Ate Len Noodle House`** (`vendors.js:91`), **`The Sweet Spot`** (`vendors.js:110`), **`Kuya Boy Smoky Grill`** (`vendors.js:129`), `Brekkie Cart`, `Rice Rush`. The three longer names — corrected here from the earlier short labels that did **not** match the source — are the real display names, so the `store_name` metadata the trigger writes into `vendors.name`, and the `full_name` the `(Demo Owner)` rule derives from it (snapshotted into `reviews.author_name`), both agree with the source and with the real `name` the seed `UPDATE` later writes. The `(Demo Owner)` rule yields the `full_name` from whatever that exact name is.)
  - **Ordering / conflict resolution — decision (committed):** **seed the auth users FIRST and let the signup trigger create each `vendors` row** (from `store_name`, owner = the new user), rather than seeding vendor rows separately and back-patching `owner_id`. This removes the double-insert hazard entirely: there is exactly one writer of a given `vendors` row (the trigger). The trigger's minimal INSERT supplies `owner_id`, `name`, and the slug `id`, and relies on column defaults for every other `NOT NULL` column — including `category`/`location_area` (defaults `'uncategorized'`/`'unassigned'`, backed by seeded lookup rows so the FK holds — §1) and `hours_open/close` (`'00:00'`). The remaining real fields — `category`, `location_area`, `description`, `hours_open/close`, `rating`, `review_count`, `phone`, `cover_tint` — are then applied by an `UPDATE` in the seed script carrying the real values from `vendors.js`. **The seed-script `UPDATE` keys on `owner_id`** (the auth user id returned by `createUser`), not on slug: `owner_id` is always present and stable, so the update is robust regardless of how the slug was derived. The slug `id` is preserved because the seed script passes the desired slug to the trigger via a metadata key `store_slug: '<slug>'`, and the trigger uses `raw_user_meta_data->>'store_slug'` as the `vendors.id` when present (the slug rule and its self-signup fallback are specified in §3's trigger note). For the seed path the vendor insert is `ON CONFLICT (id) DO NOTHING`, so the trigger's row creation is idempotent; the self-signup path uses a plain conflict-surfacing INSERT (not `DO NOTHING`) with a guaranteed-unique generated slug, so a self-signup vendor is never silently left store-less (see §3, Finding 2 resolution).

  **Seed re-run contract — `createUser` is not idempotent, so look up before creating (resolves the Rev-4 review Finding 2).** `supabase.auth.admin.createUser` is **rejected by GoTrue on a second run** for an already-registered `<slug>@foodherons.local` email — it does not silently return the existing user. A naive re-run would abort on the first `createUser`, and because every follow-up statement (the `vendors` poll and the real-column `UPDATE`) keys on the auth user id that call would have returned, none of them run and the seed's real-column values are never re-applied. The `ON CONFLICT DO NOTHING` on the trigger's vendor insert does **not** cover this, because the failure happens in GoTrue before the trigger ever fires. The seed script therefore follows a **lookup-first, create-if-absent** contract per account:
  1. Resolve the account by email first (`supabase.auth.admin.listUsers` filtered to the `<slug>@foodherons.local` address, or an equivalent lookup). Call `createUser` **only when the lookup returns no user**; when the user already exists, reuse its id. (Equivalently: call `createUser`, and on the duplicate-email error resolve the existing id and continue — same outcome.)
  2. With the resolved id (whether just-created or pre-existing), run the `vendors` poll (step 2 above) and the `owner_id`-keyed real-column `UPDATE` (with its `rowcount = 1` assertion).

  This makes the whole seed genuinely idempotent: a first run creates 8 users + stores and fills them in; a second run finds all 8 users, skips creation, and simply re-applies the real-column `UPDATE` (converging to the same state). It is the mechanism behind Phase A's "re-running the seed is idempotent and safe" acceptance criterion.

  **Ordering is made robust, not bet on a timing assumption (resolves the current MEDIUM finding; supersedes the earlier "synchronous-trigger as fact" wording).** The "seed users first, trigger creates the row, then `UPDATE` keyed on `owner_id`" scheme *expects* that `handle_new_user` is a synchronous trigger executing inside the GoTrue `auth.users` INSERT transaction — so that by the time each `supabase.auth.admin.createUser` call resolves, that user's `profiles` row **and** its owned `vendors` row (carrying `owner_id = new.id`) already exist and are committed. **This is `handle_new_user`'s expected behavior, to be confirmed against the real project in Phase A — it is NOT asserted as an established Supabase/GoTrue guarantee**, because trigger-commit timing and the follow-up pooled connection's visibility of the new row are runtime properties the design cannot verify from the repo (replication lag on a read replica, a separate pooled session, or a future GoTrue/webhook change could make the row not-yet-visible the instant `createUser` resolves). The seed is therefore written to be **deterministic regardless of that timing**:

  1. The seed script `await`s each `createUser` and processes that account's follow-up **sequentially**, after the call resolves (not a fire-and-forget batch), keying all follow-up statements on the returned auth user id.
  2. **Poll-then-act, don't assume visibility.** Before the `UPDATE`, the script `SELECT`s the owned `vendors` row by `owner_id = $1`, **retrying with a short backoff** (e.g. ~50 ms steps, total budget a few hundred ms); only if the row is still absent after the retry budget does it fail. This tolerates an `AFTER`/slightly-deferred trigger or brief cross-connection lag without silently dropping data, and it is the single mechanism that removes the dependency on cross-transaction visibility being instantaneous. (Chosen over the alternative of making the seed script itself the sole writer of seed `vendors` rows via an explicit `INSERT ... ON CONFLICT (id) DO UPDATE` — option (b) — so the "exactly one writer of a `vendors` row = the trigger" decision from §3 is preserved unchanged; the poll only *reads* before updating.)
  3. **Rowcount backstop.** After the row is confirmed present, the script runs `UPDATE vendors ... WHERE owner_id = $1` and **asserts `rowcount = 1`, failing loudly otherwise.** An `UPDATE ... WHERE owner_id = $1` that matches zero rows is **not** a SQL error, so without this check a genuinely missing row (poll budget exhausted, or a trigger moved to an async webhook) would let the `UPDATE` silently touch nothing and quietly drop every seed store's `rating`/`review_count`/real-column values. The assertion turns that into a hard, surfaced failure.

  Net: the poll (step 2) makes the seed *work* under a non-instantaneous trigger; the assertion (step 3) makes it *fail loudly* rather than silently if the row is truly absent. The synchronous-trigger behavior is the expected fast path, verified in Phase A, with the poll covering the case it does not hold instantly.

  Net effect: 8 auth users → 8 profiles (role vendor) → 8 owned `vendors` rows carrying their real slugs and data (each initially `uncategorized`/`unassigned`, then `UPDATE`d — with an asserted `rowcount = 1` — to real category/location by the seed script), each editable by logging in as the fake-email account.
- `vendors`: the 8 stores (`tita-nenas`, `campus-brews`, `crunch-corner`, `noodle-house`, `sweet-spot`, `smoky-grill`, `brekkie-cart`, `rice-rush`) are **owned, not owner-less**: their `vendors` rows are created by the signup trigger for the 8 demo accounts above (owner = the fake-email user) and then filled in with their real `name`, `category`, `location_area`, `description`, `hours_open`, `hours_close`, `rating`, `review_count` (current `reviews` number), `phone` (where present), `preorder_enabled`, `cover_tint` by the seed-script `UPDATE`. Every seed vendor therefore has a working owner login (Change 2) — reversing the earlier `owner_id = NULL` plan (see Q4). An admin can later re-point `owner_id` to a real vendor's account via the admin dashboard ("claim" — Change 1).
- `menu_items`: every `menu[]` entry (e.g. `tapsilog 75`, `tocilog 70`, `hotsilog 60`, `extra-rice 20`, `iced-tea 25`, `wintermelon 65`, `mango-shake 60 available=false`, `halohalo 65 available=false`, `isaw 30`, `pork-bbq 35`, …) with `vendor_id`, `price`, `category`, `available`, `description` (current `desc`).
- `reviews`: **not seeded from `reviews.js`** — those are procedurally generated fakes (`POOL` + hash), not real data. **Decision:** seed `reviews` as empty and let `vendors.rating`/`review_count` carry the existing display numbers as denormalized starting values. The `getReviewsFor` "No reviews yet" empty state already exists for zero reviews. This is honest (no fabricated reviewers in the real DB) and the store page still shows the historical rating. (Alternative: seed a few sample reviews tied to seed orders — deferred; the fake pool shouldn't become real content.)
- `studentSample.js` (`ACTIVE_ORDERS`, `PAST_ORDERS`, `FAVORITES`, `PENDING_REVIEWS`, `PAST_REVIEWS`) and `Dashboard.jsx` `SEED_ORDERS`/`SEED_HISTORY`: **not seeded.** These are per-user demo artifacts with no real owner and item names that don't even match the menus (audit finding H2: "Iced Matcha", "Spanish Latte", "Longsilog" aren't real menu items). Real orders/favorites appear once real students place them. This satisfies the user's explicit instruction to "delete all the seeded data in the code base."

### Admin dashboard (Change 1 — new frontend surface)

A new `/admin` route (role-gated `RequireRole role="admin"`, §3) renders an `Admin` page under `src/pages/Admin.jsx`. It is a **functional management console, not an analytics suite** — scoped to the app's real features. It has three sections (tabs or stacked panels, matching the Dashboard's existing tabbed layout convention in `Dashboard.jsx`):

- **(a) Manage vendors.** Lists **all** vendors from a Supabase `select * from vendors` (admin SELECT = all, already public anyway) joined/annotated with each owner's name/email (admin can read any `profiles` row, §2). For each vendor the admin can:
  - **Assign/change owner (`owner_id`)** — the "claim" tool (ties to Change 2): a control to set `vendors.owner_id` to a chosen `profiles.id` (e.g. select a user by email). This is a **direct-Supabase `update` under admin RLS** (`vendors` UPDATE allows admin, and the column guard permits an admin to change `owner_id`, §2). Use it to re-point a seed store from its fake-email demo account to a real vendor's account.
  - **Toggle `preorder_enabled`** and **edit store info** (name/category/location/hours/phone/logo/cover) — the same fields a vendor edits, reusing the existing `updateVendorInfo`/`setPreorderEnabled` write shape (`VendorContext.jsx:90-99`), but issued as admin-RLS Supabase writes against any vendor (not just an owned one). **Parameterization note (resolves the Rev-4 NIT):** those `VendorContext` functions target the logged-in vendor's own store via `currentVendorId` (`VendorContext.jsx:47`), which for an admin is meaningless (an admin has no own store). The admin console therefore does **not** call `updateVendorInfo`/`setPreorderEnabled` verbatim — it issues the **same column set / Supabase `update` shape** but **parameterized by the selected vendor's `id`** (the row the admin is editing), not `currentVendorId`. "Reuse" here means reuse the write shape and column list, not the context binding.
  - For the vendor **list display**, reuse the look of `VendorCard.jsx` where convenient, but note `VendorCard` is a `<Link>` to `/vendor/:id` (`VendorCard.jsx:38`) built for the public browse grid; the admin list needs inline action controls, so the admin table is a lightweight local row component (reusing `VendorCard`'s open/closed + preorder badges and `categoryName()` labeling) rather than the clickable card verbatim. This keeps the management affordances (assign-owner, toggle, edit) from fighting the card's navigation click.
- **(b) Moderate reviews.** Lists reviews (admin SELECT; reviews are public anyway) with vendor + `author_name` + `ordered_summary` + rating + text, and a **delete** action per review — a direct-Supabase `delete` under the admin DELETE policy on `reviews` (§2). Deleting a review fires the existing reviews→vendor aggregate trigger, so `vendors.rating`/`review_count` self-correct. No edit of review content (moderation = remove, not rewrite).
- **(c) View all orders (read-only).** Lists orders across all vendors via a Supabase `select` (admin SELECT = all orders + order_items, §2), with status, vendor, student pickup name, code, totals, placed-at. **Read-only:** the admin console does **not** mutate order status — order writes stay the C# service's job (§2/§4). If forcing a status is ever needed it becomes a future service endpoint, not a direct admin write.

Which path backs each action: **(a) assign-owner / toggle / edit store** and **(b) delete review** are **direct-Supabase under admin RLS**; **(c) orders** is a **direct-Supabase read**; no admin action goes through the C# service in this pass (the service's mandate stays order placement + transitions). The `Admin` page uses the same Supabase client and `useAuth()` role as the rest of the app.

### Files to remove / rewire (enumerated by real path)

Files importing from `src/data/` (confirmed by search):

| File | Imports from data | Rewire |
| --- | --- | --- |
| `src/context/VendorContext.jsx` | `vendors as seedVendors` (`:2`) | Replace `loadVendors()`/`seedVendors` with a Supabase fetch (`select * from vendors` + `menu_items`), grouped into the same vendor-with-`menu` shape the UI expects. Keep `isOpenNow()` + the per-minute `now` tick (pure client logic). `currentVendorId` becomes the logged-in vendor's owned store id (from `profiles`/`vendors.owner_id`), not "first preorder-enabled seed". Dashboard edit functions (`updateVendorInfo`, `setPreorderEnabled`, `saveMenuItem`, `setItemAvailable`, `deleteMenuItem`) become Supabase `update`/`insert`/`delete` calls (RLS-guarded). |
| `src/pages/Dashboard.jsx` | `categories` (`:4`) | `categories` comes from a Supabase fetch (or a small static constant kept in the frontend for labels/images). Delete `SEED_ORDERS`/`SEED_HISTORY`; fetch real orders for the owned vendor via Supabase; wire action buttons to `POST /api/orders/{id}/transition`. |
| `src/pages/Home.jsx` | `categories`, `locationAreas` (`:5`) | Source `categories` from the `categories` table and `locationAreas` from the `location_areas` table (both public-SELECT, fetched once into context). The location filter chips now read the `location_areas` rows (ordered by `sort_order`), replacing the deleted `locationAreas[]` constant — see §1 and the §5 seed list. Vendor list already comes via `useVendors()`. |
| `src/pages/Search.jsx` | `categoryName` (`:5`) | Replace `categoryName` with a lookup from the categories data loaded in context. |
| `src/pages/VendorStore.jsx` | `categoryName` (`:4`), `getReviewsFor` (`:9`) | `categoryName` via categories lookup; replace `getReviewsFor(vendor)` with a Supabase `select` of real `reviews` for the vendor (reading `author_name`, `ordered_summary`, `rating`, `text`, `helpful_count`, `created_at`), plus the `rating`/`review_count` already on the vendor row. The `ordered` string reads the `reviews.ordered_summary` snapshot column directly — **no `order_items` join** (the store page's anonymous/non-owner audience cannot read `order_items`; see §1 trigger and §2). **The store page is read-only for reviews** — review *submission* is NOT wired here; it is driven from `OrderStatus.jsx` (completed state) and the `Profile.jsx` `PENDING_REVIEWS` list (see §2 review-submit flow), since only those screens hold a completed, owned order. |
| `src/pages/Profile.jsx` | `vendors as ALL_VENDORS` (`:6`), `studentSample` exports (`:9`) | Remove `ALL_VENDORS` (use `useVendors()`); replace `ACTIVE_ORDERS/PAST_ORDERS/FAVORITES/PENDING_REVIEWS/PAST_REVIEWS` with Supabase fetches scoped to `auth.uid()` (orders, favorites, reviews). Remove `PREVIEW_USER` and restore the `/login` redirect. |
| `src/components/VendorCard.jsx` | `categoryName` (`:4`) | `categoryName` via categories lookup from context. |
| `src/App.jsx` | — (no data import) | Add the `/admin` route (`RequireRole role="admin"`) to the `<Routes>` block (`App.jsx:40-50`) and import the new `Admin` page; also add the `RequireAuth`/`RequireRole` guards here per §3. |
| `src/components/Header.jsx` | — (no data import) | Extend `profilePath` (`Header.jsx:18`) and the primary nav (`Header.jsx:47-53`) so admins get an **Admin** link to `/admin`; switch role checks to lowercase canonical (§3); drop the preview-only `/profile` link (`Header.jsx:55-60`). |

New files added (not rewires):
- **`src/pages/Admin.jsx`** — the admin dashboard surface described above (manage vendors, moderate reviews, view all orders). Reads/writes via the Supabase client under admin RLS; no C# calls.

Context files to rewire (beyond imports above):
- **`src/context/AuthContext.jsx`** — replace `DEMO_MODE`/`DEMO_STUDENT`/`readUser()` localStorage shim with Supabase Auth session wiring (§3); real `changePassword`; honest `deleteAccount`.
- **`src/context/CartContext.jsx`** — mostly unchanged (stays client-side, single-vendor). It reads menu via `useVendors()` which now comes from Supabase. `placeOrder` moves out of `Cart.jsx` into a call to the C# service.
- **`src/context/VendorContext.jsx`** — as above.

Then **delete** the three data files: `src/data/vendors.js`, `src/data/reviews.js`, `src/data/studentSample.js`. Also delete the demo order writer in `Cart.jsx` (`sessionStorage.setItem('order-…')`), the `OrderStatus.jsx` auto-advance `setTimeout` (audit H4) in favor of reading real status, and the `Dashboard.jsx` seed arrays.

Removal ordering (so the app never imports a deleted file): rewire each consumer to its Supabase source **first**, verify build, **then** delete the data files last.

---

## 6. Config / secrets

### Frontend (Vite — only `VITE_`-prefixed vars reach the client)

`.env.local` (git-ignored):
```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>     # safe to ship to the browser; RLS protects data
VITE_API_BASE_URL=/api                        # C# service base (dev uses Vite proxy)
```
The anon key is designed to be public; security rests on RLS, not on hiding it. The **service-role key is NEVER** in any `VITE_` var or the frontend bundle.

### C# service (never committed)

Dev via `dotnet user-secrets`; prod via environment variables:
```
ConnectionStrings__Postgres=Host=...;Database=postgres;Username=...;Password=...;SSL Mode=Require
Supabase__ServiceRoleKey=<service role key>   # only if REST admin calls are added
Supabase__JwtSecret=<project jwt secret>      # HS256 mode
Supabase__Url=https://<project>.supabase.co
Supabase__Issuer=https://<project>.supabase.co/auth/v1
Supabase__Audience=authenticated
```

### Seed demo vendor accounts + first admin (Change 1 & 2 — getting-started notes)

Two demo-only facts that belong in the getting-started doc / README (not in any committed secret file):

- **Seed vendor logins (Change 2).** The 8 seed vendors are owned by auth users with **fake emails** of the form `<vendor-slug>@foodherons.local` (e.g. `tita-nenas@foodherons.local`), all sharing **one demo password: `FoodHerons!Demo2026`**. These let anyone log in as a seed store and see/edit it in the vendor dashboard for demos. **Security tradeoff — demo only:** a single shared, publicly-documented password across 8 accounts is deliberately insecure (anyone who reads the docs can log into every seed store); it is acceptable **only** because these are throwaway demo stores on a fake, non-deliverable email domain. The getting-started doc must label this **demo-only / change-before-production**: before any real deployment, rotate or delete these accounts (or re-point each store's `owner_id` to a real vendor via the admin dashboard and disable the demo logins). The shared password is passed to the seed script via an env var (e.g. `SEED_VENDOR_PASSWORD`, git-ignored) rather than hard-coded, so production can override it; its default documented value is `FoodHerons!Demo2026`.
- **First admin (Change 1).** There is no admin signup. After the seed runs, create the first admin by promoting an account in the Supabase SQL editor: `UPDATE public.profiles SET role = 'admin' WHERE email = '<your-admin-email>';` (§3 "Creating an admin"). Document this one-time bootstrap step and note that only someone with DB / service-role access can perform it.

### `.env.example` template plan

Commit `/.env.example` (frontend) and `/server/FoodHerons.Api/.env.example` (service) with the keys above but **placeholder values only**. `.gitignore` is extended to cover `.env.local`, `.env`, `server/**/.env`, `bin/`, `obj/`. The existing `.gitignore` ignores `.env`, `.env.*`, and `*.local` (audit confirms no `.env` is committed), so `.env.example` is matched by `.env.*` and would be ignored. **Decision:** add `!.env.example` and `!server/FoodHerons.Api/.env.example` negations **placed after the `.env.*` line** (a negation only takes effect if it follows the pattern that would otherwise ignore the file) so the templates are tracked while real env files stay ignored. Note `.env.local` is doubly ignored (by both `*.local` and `.env.*`), which is fine.

---

## 7. Phased implementation plan

Dependencies: Phase A has no code dependency on B/C; Phase B depends on A (schema + anon read); Phase C depends on A (tables) and benefits from B (frontend to call it). Build A → B → C.

**Phase A — Supabase schema + RLS + seed (DB only).**
- Author migrations: enums (`order_status`, `user_role` **with the new `admin` value** — Change 1), `categories`, `location_areas`, `vendors`, `menu_items`, `orders`, `order_items`, `reviews`, `favorites`; the `order_code_seq` sequence; the `public.auth_role()` helper; triggers (`handle_new_user` **with the admin-coercion guard and the `store_slug`/`ON CONFLICT` vendor insert**, profiles-role/ownership guard **that exempts admins**, vendors column guard **that exempts admins for `owner_id`/preorder/info**, `set_review_snapshot`, reviews→vendor aggregate); all RLS policies (§2, **each content table now owner/role OR admin, plus admin-only policies where the client verb was none**); seed migration (§5) for categories/location_areas/menu_items. Ensure `gen_random_uuid()` is available (built into Supabase Postgres 13+ via core/`pgcrypto`; add `create extension if not exists pgcrypto` if needed).
- **Seed demo vendor accounts (Change 2):** run the seed script that calls `supabase.auth.admin.createUser` (service-role) for the 8 `<slug>@foodherons.local` accounts with the shared `FoodHerons!Demo2026` password and `role: 'vendor'` + `store_name` + `store_slug` metadata (so the trigger provisions each profile and owned `vendors` row with the canonical slug), then `UPDATE`s each store's remaining columns from the `vendors.js` values. Then promote the first admin via `UPDATE public.profiles SET role='admin' WHERE email=...` (§3/§6).
- Done/verified: migrations apply cleanly to the ready project; anon `select` returns the 8 vendors + menus; a manual test confirms a student JWT cannot insert into `orders` and cannot update another vendor's `menu_items`; vendor JWT can update only its own rows; **a signup attempt sending `role=admin` in metadata lands as `student` (coercion guard holds)**; **an admin JWT can update any vendor's `owner_id`/`preorder_enabled`, delete any review, and select all orders, while the `rating`/`review_count` columns remain unwritable by any client**; **logging in as `tita-nenas@foodherons.local` / `FoodHerons!Demo2026` returns a vendor session owning the `tita-nenas` store.**

**Phase B — Frontend auth + direct-Supabase data wiring + remove seed files/shims.**
- Add `@supabase/supabase-js`; create `src/lib/supabase.js` client from `VITE_` env.
- Rewrite `AuthContext` (§3) with real sessions; add `RequireAuth`/`RequireRole` guards in `App.jsx`; remove `DEMO_MODE`/`PREVIEW_USER` and restore the `/profile` redirect; fix `Header.jsx` nav + role casing (now three roles: student/vendor/admin, lowercase).
- Rewire `VendorContext`, `Home`, `Search`, `VendorStore`, `VendorCard`, `Profile`, `Dashboard` reads to Supabase (per §5 table). Rewrite vendor dashboard edit functions to Supabase writes.
- Replace `getReviewsFor` with a real reviews query on `VendorStore.jsx` (read-only). Wire review **submit** (RLS-gated, payload `{ vendor_id, order_id, rating, text }` per §2) from `OrderStatus.jsx`'s completed-state "Leave a review" button (replacing its empty TODO `onClick`) and the `Profile.jsx` `PENDING_REVIEWS` list, both of which supply the completed order's UUID as `order_id`.

**Phase B2 — Admin dashboard (Change 1, new frontend work).** This is **new** frontend work introduced by Change 1; it is placed here as a Phase B sub-phase because it depends only on Phase A (the `admin` role, admin RLS policies, and seeded data) and on the Phase B auth/guard/Supabase wiring, not on the C# service.
- Add the `/admin` route + `Admin` page (`src/pages/Admin.jsx`, §5) gated by `RequireRole role="admin"`; add the Admin nav link in `Header.jsx`.
- Implement the three panels (§5): manage vendors (list all, assign/change `owner_id`, toggle `preorder_enabled`, edit store info — direct-Supabase admin-RLS writes), moderate reviews (list + delete — direct-Supabase admin-RLS delete), view all orders (read-only direct-Supabase select).
- Done/verified: an admin login reaches `/admin` while student/vendor/anonymous are redirected; an admin can re-point a seed vendor's owner (verify the target account then sees that store in its vendor dashboard — this exercises the Change-2 "claim" flow end to end); an admin can delete a review and the vendor's `review_count` updates; the orders panel lists orders across multiple vendors read-only.

- Delete `src/data/vendors.js`, `src/data/reviews.js`, `src/data/studentSample.js`; remove `Dashboard` seed arrays and `OrderStatus` auto-advance.
- Done/verified: `npm run build` succeeds (baseline: current build passes, 75 modules); logged-out user sees public browse only; `/profile`, `/dashboard`, and `/admin` redirect when unauthenticated/wrong-role; a student login shows real (empty) orders/favorites; a vendor login sees only its own store in the dashboard; **logging in with a `<slug>@foodherons.local` / `FoodHerons!Demo2026` demo account shows and can edit that seed store in the vendor dashboard** (Change 2); no remaining imports from `src/data/` (grep returns none).

**Phase C — C# order service + wire Cart/OrderStatus/Dashboard to it.**
- Scaffold `server/FoodHerons.Api` (net10.0 Minimal API); add `JwtBearer` (§4) + Npgsql; implement `POST /api/orders` and `POST /api/orders/{id}/transition` with price validation, server-side totals, status state machine, error contract (§4).
- Add a `server/FoodHerons.Api.Tests` xUnit project covering the pure logic that does not need a DB: `OrderService` total computation (server prices win over any client-sent price; duplicate line ids merge; unavailable/unknown item → 422), the Asia/Manila openness evaluation including the overnight-wrap case, and the transition state machine (legal forward moves, rejected skips/backward/terminal moves, student-cancel-only-while-pending). These are the `dotnet test` targets below; the frontend has no test runner (`package.json` has no test script), so Phase B relies on `npm run build` + manual checks.
- Configure secrets via user-secrets; add the Vite `/api` proxy; set `VITE_API_BASE_URL`.
- Rewrite `Cart.jsx` `placeOrder` to call the service; `OrderStatus.jsx` to read real status via Supabase and student-cancel via the service; `Dashboard.jsx` action buttons to call transition.
- Done/verified: placing an order with tampered client prices still charges DB prices (manual test: send a fake low price → server ignores it); only the ordering student can place; only the owning vendor can advance status; illegal transitions return 409; `dotnet build` passes and `dotnet test` passes (the xUnit suite above for total computation, openness, and the transition state machine); end-to-end: add to cart → place → appears in vendor dashboard → vendor advances → student tracker reflects real status.

Per-phase "done" always includes: build passes, no secrets committed (`git status` clean of `.env`/`.env.local`), and the specific manual auth/price checks above.

Environment context: user is on Windows, has .NET 10 SDK (10.0.401) and Node v24, a ready Supabase project, and will paste Supabase keys into git-ignored config at the start of each phase that needs them (A: DB connection for CLI **plus the service-role key for the seed script's `auth.admin.createUser` demo-account calls, and `SEED_VENDOR_PASSWORD`**; B: URL + anon key; C: service-role DB connection + JWT secret/JWKS).

---

## 8. Open questions / assumptions (recommended defaults)

1. **Vendor approval / anti-abuse (updated for the admin role).** Anyone can still self-register as a `vendor` and create a store; new stores ship with `preorder_enabled = false` so they are listing-only until the owner completes setup. **Change 1 adds a moderation lever that did not exist before:** an **admin** can now review stores and delete/unassign (`owner_id`) or leave-disabled an abusive store from the admin dashboard — so the earlier "no admin to approve vendors" caveat is resolved into a reactive moderation capability (not a pre-approval gate). A pre-approval workflow (admin must approve before a store lists) is still **not** built; recommended default remains open vendor self-signup with reactive admin moderation. Revisit with an `@umak.edu.ph` email restriction if spam grows. **Assumption unless corrected: open vendor signup + reactive admin moderation.**

2. **Server-side cart persistence.** Recommended default: **no** — cart stays client-side (localStorage), order placement is the authoritative server moment. **Assumption: client-only cart.**

3. **Order cancellation window.** `OrderStatus.jsx` shows Cancel only during `pending`. Recommended default: students may cancel only while `pending`; once the vendor accepts (`preparing`), only the vendor may cancel (reject with reason). This is now enforced in §4 via a `FOR UPDATE` status read inside the transition transaction — a student cancel racing a vendor accept returns 409 `ILLEGAL_TRANSITION` if the order already moved to `preparing`. **Assumption: student-cancel limited to `pending`, enforced atomically.**

4. **Seed vendors are owned by pre-seeded fake-email demo accounts (resolved — Change 2).** The earlier "owner-less, read-only until claimed" plan is **reversed**: each of the 8 seed vendors now has a real Supabase auth owner at `<slug>@foodherons.local` sharing the demo password `FoodHerons!Demo2026` (§5/§6), so every seed store has a working, editable vendor login out of the box. The "claim" mechanism is no longer deferred — it is the **admin dashboard's assign/change-owner tool** (Change 1): an admin re-points a seed vendor's `owner_id` to a real vendor's account when a genuine owner takes over, then the demo login can be retired. **Decision: seed vendors are demo-owned and editable; re-ownership is an admin action.** (Security tradeoff of the shared demo password is acknowledged in §6 — demo-only, change before production.)

5. **Account deletion.** Supabase client can't delete its own auth user. Recommended default: defer a real delete; keep `deleteAccount` throwing an honest "not available yet" error (already the current stub), and add a `security definer` RPC or an admin task later. **Assumption: deletion deferred.**

6. **JWT signing mode.** Need to confirm whether the ready project uses the legacy HS256 shared secret or new asymmetric signing keys (JWKS), to configure the C# `JwtBearer` validator. Recommended default: prefer JWKS/asymmetric if available (no shared secret in the service); fall back to HS256 secret. **Needs user confirmation at Phase C start.**

7. **Facebook login.** `Signup.jsx`/`AuthLayout.jsx` have a "Continue with Facebook" stub. Recommended default: ship email/password first; defer Facebook OAuth (it needs a Supabase provider config + role selection flow for OAuth users, which complicates the one-role-at-signup rule). **Assumption: Facebook deferred.**

8. **Existing demo users.** `DEMO_STUDENT`/`PREVIEW_USER` are not real accounts and map to nothing; they're simply deleted. **Assumption: no migration of demo users.**

9. **Role casing.** Code is inconsistent (`'Student'` vs `'student'`). The DB enum and all rewritten code standardize on **lowercase** `student`/`vendor`. **Assumption: lowercase canonical, UI labels capitalized at render.**

10. **Location-area integrity (resolved, no longer open).** `vendors.location_area` is constrained by a `location_areas` lookup table with an FK (§1), not left as free text. This is now a committed design decision rather than an open question; listed here only so the earlier ambiguity is explicitly retired. Adding/removing a campus area is a plain data change (insert/delete a `location_areas` row), no schema migration. **Decision: lookup table + FK; no further input needed.**

---

### Responses to review findings

#### Revision 5 — final resolutions (the 5 findings in the last `design-verdict.json`, applied by the orchestrator after the design-update loop hit its iteration cap)

The design-update workflow's loop reached its iteration limit with the Rev-4 document's final `design-verdict.json` still at **CHANGES_REQUESTED (2 MEDIUM, 3 NIT)** — all 5 confined to Change 2's seed/trigger path; Change 1 (admin role, dashboard, RLS completeness, privilege-escalation guard) had already passed every checklist item. Because each remaining finding carried an unambiguous fix in the verdict text, they were applied directly as Revision 5. Each fix was re-verified against the real source before editing:

1. **[MEDIUM] Signup trigger's vendor-INSERT branch was keyed on the client-controllable `store_slug` metadata flag, not on the caller — a crafted browser `signUp` sending `store_slug:'tita-nenas'` could take the `DO NOTHING` branch, collide the seed slug, and be left store-less.** Addressed with the verdict's preferred option (a). §3's "Vendor slug `id` — rule" is rewritten so the branch is selected by the **caller**: the service/seed connection (`current_setting('request.jwt.claims', true) IS NULL`, the same test §2 already uses) is the only path that honors `store_slug` and uses `ON CONFLICT (id) DO NOTHING`; **any JWT-bearing browser caller ignores `store_slug` entirely** and always takes the slugify-with-unique-suffix, conflict-surfacing INSERT. A real self-signup therefore can neither target a canonical seed slug nor end up store-less regardless of the metadata it sends, and the silent-skip branch is unreachable from the browser. §5's seed-ordering bullet is updated to refer to the "service-connection `store_slug`/`DO NOTHING` branch".

2. **[MEDIUM] Seed re-run idempotency was claimed but `supabase.auth.admin.createUser` is not idempotent (rejects a duplicate email on the second run), with no re-run policy stated.** Addressed with the verdict's fix. §5 adds an explicit **"Seed re-run contract — lookup-first, create-if-absent"** paragraph: the script resolves each account by email first (`admin.listUsers` filtered, or catch-the-duplicate-error) and calls `createUser` only when absent, reusing the existing id otherwise; the `owner_id`-keyed `vendors` poll + real-column `UPDATE` (with its `rowcount = 1` assertion) then run on every pass. It also corrects the earlier over-claim that the vendor insert's `ON CONFLICT DO NOTHING` provided re-run idempotency (it cannot, since `createUser` fails in GoTrue before the trigger fires). Net: a second run finds all 8 users, skips creation, and re-applies the `UPDATE`, converging to the same state — satisfying Phase A's "re-run is idempotent and safe" criterion.

3. **[NIT] §4 `PlaceOrderResponse` example used the old 4-digit `FH-4833`, contradicting §1's zero-padded 6-digit sequence format.** Corrected the §4 example to `"code": "FH-000142"`, matching §1's `'FH-' || lpad(nextval('order_code_seq')::text, 6, '0')`.

4. **[NIT] `Cart.jsx` order-object literal cited as `:33-42` (off by one at the start).** Corrected to `:32-41` in §1 (the `setItem` call at `:43` and the whole-body `:30-44` span were already correct and are unchanged).

5. **[NIT] `App.jsx` `<Routes>` block cited as `:42-50` (starts two lines late).** Corrected to `:40-50` in §3.

No new material was introduced beyond these five fixes; all prior Rev-1→Rev-4 decisions are preserved, and the run stayed design-only (only `design.md` edited — no `.sql`, no C# scaffold, no app-code changes). **The design is considered APPROVED for implementation** on the strength of: Change 1 having passed review outright, and these 5 remaining Change-2/citation findings being resolved verbatim per the reviewer's own stated fixes.

#### Revision 4 — review-loop resolutions (the 5 findings in the prior `design-verdict.json`)

The **current** `design-verdict.json` / `design-review.md` returned **CHANGES_REQUESTED** (1 HIGH, 1 MEDIUM, 3 NIT) on the Revision 4 document. All 5 findings are now **addressed** in this pass; none was backlogged or ignored, and each fix stays inside the two approved changes and the preserved Rev-3 decisions. Each claim was re-verified against the real source before editing:

1. **[HIGH] §5 demo-account table listed three store display names that did not match `src/data/vendors.js` verbatim — breaking the determinism the fix depended on.** Addressed with the reviewer's preferred (verbatim-match) option. The per-slug demo-account table in §5 is corrected so `noodle-house` reads **`Ate Len Noodle House`** (verified `vendors.js:92`), `sweet-spot` reads **`The Sweet Spot`** (`vendors.js:111`), and `smoky-grill` reads **`Kuya Boy Smoky Grill`** (`vendors.js:130`); the five already-correct rows are unchanged. The `full_name` column follows via the unchanged `"<store display name> (Demo Owner)"` rule (so the three become `Ate Len Noodle House (Demo Owner)`, `The Sweet Spot (Demo Owner)`, `Kuya Boy Smoky Grill (Demo Owner)`). The surrounding prose is tightened to cite the source lines and to state explicitly that `store_name` now matches `vendors.js` verbatim, so the trigger-written `vendors.name`, the seed-`UPDATE` real name, and the `full_name` snapshotted into the `NOT NULL`, UI-visible `reviews.author_name` all agree — the self-contradiction the finding flagged is removed.

2. **[MEDIUM] The "`handle_new_user` runs synchronously inside the `auth.users` INSERT transaction" timing assumption was asserted as fact on a Phase-A-critical seed path, with no deterministic fallback.** Addressed with the reviewer's option (a): the seed is made robust instead of betting on the assumption. §5's timing paragraph is rewritten to (1) **downgrade the synchronous-trigger claim from established fact to "expected behavior, confirmed against the real project in Phase A"** (explicitly noting trigger-commit timing and follow-up-connection visibility are unverifiable from the repo); (2) add a **poll-then-act** step — before the `UPDATE`, the seed script `SELECT`s the owned `vendors` row by `owner_id` with a short backoff (a few hundred ms budget) and only fails if still absent, which tolerates an `AFTER`/deferred trigger or brief cross-connection lag without silently dropping data; and (3) keep the **`rowcount = 1` assertion** as the backstop so a genuinely missing row still aborts loudly. Option (b) (make the seed script the sole `vendors` writer) was considered and rejected so the "exactly one writer = the trigger" §3 decision is preserved; the poll only *reads* before updating.

3. **[NIT] The service-role early-return's `current_user IN ('postgres','supabase_admin','service_role')` list is an environment-dependent role-name guess.** Addressed. §2's `guard_vendor_columns` snippet now annotates the first operand as **AUTHORITATIVE** and adds a paragraph stating that `current_setting('request.jwt.claims', true) IS NULL` ("no PostgREST/GoTrue JWT context") is the load-bearing test, while the `current_user IN (...)` list is an explicitly-labelled belt-and-suspenders secondary check **not relied upon for correctness**, whose membership is confirmed against the real project in Phase A (print `current_user` from the seed connection; add it if different). §3's "Creating an admin" sentence is updated to cite the authoritative `request.jwt.claims IS NULL` condition rather than leaning on the role list.

4. **[NIT] `AuthContext.jsx` stub range cited as `:47-52`, one line short of `deleteAccount` (ends at 53).** Addressed with the reviewer's "cite separately" alternative (cleaner than a lumped span). §3 now cites the `changePassword` stub at **`AuthContext.jsx:47-49`** and the `deleteAccount` stub at **`:51-53`** (verified against source: `changePassword` 47-49, `deleteAccount` 51-53).

5. **[NIT] Cart order-blob citation `Cart.jsx:32-41` ended before the actual `setItem` (order object 33-42, `setItem` at 43).** Addressed. Both occurrences (§1 orders intro and §4 place-order note) now cite **`Cart.jsx:30-44`** (the whole `placeOrder` body) and explicitly call out the order object at `:33-42` and the `sessionStorage.setItem(\`order-${orderId}\`, …)` at `:43` (verified against source).

#### Revision 4 — earlier review-loop round (the 6 findings resolved in the prior pass)

A prior Rev-4 review round returned **CHANGES_REQUESTED** (1 HIGH, 2 MEDIUM, 3 NIT). All 6 findings were **addressed** in that pass; none was backlogged or ignored, and each fix stayed inside the two approved changes and the preserved Rev-3 decisions:

1. **[HIGH] Column-guard triggers never defined the service-role exemption; Change 2's seed `UPDATE` of `rating`/`review_count`/`owner_id` relied on it.** Addressed with the reviewer's preferred fix. §2's `guard_vendor_columns` note and the `profiles` role-guard note both now open the trigger with the explicit service-role early-return `IF current_setting('request.jwt.claims', true) IS NULL OR current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;` **before** any `public.auth_role()` logic, so a service/seed/`postgres` connection is unguarded and the admin/client column restrictions apply only to JWT-bearing browser callers. §2 states the §5 seed `UPDATE` of `rating`/`review_count`/`owner_id` and the §3 admin-bootstrap `UPDATE public.profiles SET role='admin'` both run under this exempt path; §3's "Creating an admin" and §4's invariant row are updated to reference the early-return rather than the old (incorrect) "RLS-bypass means trigger-bypass" wording. This removes the Phase A feasibility gap (seed `UPDATE` no longer blocked).

2. **[MEDIUM] Seed ordering between `createUser` (trigger side-effect) and the follow-up `UPDATE` had no stated timing guarantee.** Addressed in that pass by first stating `handle_new_user` as a synchronous `auth.users`-transaction trigger and adding the `rowcount = 1` assertion. **Superseded by the CURRENT pass's Finding 2** (above): the synchronous-trigger claim is now downgraded to "expected, verified in Phase A" and a poll-with-backoff was added so the seed is deterministic rather than betting on that timing — the `rowcount = 1` assertion is retained as the backstop.

3. **[MEDIUM] Seed demo accounts' `full_name` source unspecified, and `.local` acceptance by GoTrue asserted without confirmation.** Addressed in §5's demo-accounts bullet. (a) The 8 `full_name` values are now given explicitly in a per-slug table, derived deterministically as `"<store display name> (Demo Owner)"` (so nothing implementer-invented reaches the `NOT NULL` column snapshotted into `reviews.author_name`, and demo-authored reviews are visibly non-real). (b) A sentence now states that GoTrue validates email **shape** (not deliverability), that `<slug>@foodherons.local` is syntactically valid, and that `email_confirm: true` is what makes the unroutable `.local` domain acceptable (no confirmation mail attempted).

4. **[NIT] Minor `file:line` drift in four citations.** Addressed (substance was already correct). `Signup.jsx:19` → `:18` for the `form` useState (two sites, plus a Rev-2 recap mention, with `role` noted at `:17`); `Cart.jsx:25` → `:23` for `user?.role === 'Student'`; `AuthContext.jsx:50-52` → `:47-52` to span the `changePassword` (47) and `deleteAccount` (51-52) stubs; `Header.jsx:47-49` → `:46-48` for the "Vendor Dashboard" `NavLink`. Verified each against source.

5. **[NIT] Admin "reuse `updateVendorInfo`/`setPreorderEnabled`" needed an id-parameterization note.** Addressed. §5(a) now states the admin does not call those `VendorContext` functions verbatim (they bind to the vendor-only `currentVendorId`, `VendorContext.jsx:48-50`, meaningless for an admin) but reuses the **same column set / `update` shape parameterized by the selected vendor's `id`**. §2's vendors-UPDATE note gained the same one-line clause and cross-reference to §5(a).

6. **[NIT] `favorites` UPDATE `—` left a reader unsure whether an admin grant was forgotten.** Addressed. §2's `favorites` admin note now states `favorites` has **no UPDATE for anyone, admin included** (the membership tuple has nothing mutable; a favorite change is DELETE + INSERT), so the admin grant is **SELECT/DELETE only, matching the `—`** — no grant was forgotten.

#### Revision 4 — earlier review-loop round (the first 5 findings on the Rev 4 changes)

An earlier review round on Revision 4 returned **CHANGES_REQUESTED** (1 HIGH, 1 MEDIUM, 3 NIT). All 5 findings were **addressed**; none was backlogged or ignored, and each fix stayed within the two approved changes and the preserved Rev-3 decisions:

1. **[HIGH] Signup trigger's `vendors` INSERT violates `NOT NULL` on `category`/`location_area`.** Addressed with the reviewer's preferred fix. §1 now gives `vendors.category text NOT NULL DEFAULT 'uncategorized' REFERENCES categories(id)` and `vendors.location_area text NOT NULL DEFAULT 'unassigned' REFERENCES location_areas(id)`, and seeds the two safe-default lookup rows (`categories('uncategorized','Uncategorized',…)`, `location_areas('unassigned','Unassigned',…)`) so the defaults satisfy their FKs. §1's hours note is extended to explain this mirrors the `'00:00'` pattern; §3 step 2 states the trigger's minimal INSERT lists only `owner_id`/`name`/`id` and relies on these defaults (so it can never hit a `NOT NULL`/FK violation); §5 notes seed vendors land `uncategorized`/`unassigned` and are then `UPDATE`d to real values. This unblocks both self-signup vendors and every Change-2 seed demo account, so Phase A's "migrations apply cleanly / anon select returns the 8 vendors" criterion is now reachable.

2. **[MEDIUM] Trigger slug fallback + seed-script `UPDATE` key under-specified.** Addressed in §3's trigger note and §5. §3 now defines the slug rule explicitly: use `store_slug` metadata verbatim when present (seed path); otherwise slugify `store_name` via `lower(regexp_replace(store_name,'[^a-z0-9]+','-','gi'))` trimmed of stray `-`, appending `-2`, `-3`, … on collision so the id is always unique. The seed path keeps `ON CONFLICT (id) DO NOTHING` (idempotent re-seed); the **self-signup path does NOT use `DO NOTHING`** — the guaranteed-unique generated slug means the plain INSERT cannot collide, and any unexpected conflict surfaces as an error instead of silently creating no store (closes the data-loss path). §5 states the seed-script `UPDATE` **keys on `owner_id`** (stable, always present), not on slug.

3. **[NIT] `VendorCard` `<Link>` line reference off by two.** Addressed. Changed `VendorCard.jsx:40` → `VendorCard.jsx:38` in both places (§5 vendor-list reuse note and the Revision 4 change-response below). Verified: the `<Link to={`/vendor/${id}`}>` is on line 38.

4. **[NIT] Admin `favorites` SELECT/DELETE grant has no stated use.** Addressed with the reviewer's preferred option (one-line justification rather than dropping the grant). §2 adds a note that admin `favorites` access is forward-looking (a future user-management view), symmetric with the other content-table grants, exposes no data path today (admins are already logged-in and role-gated), and is flagged so the intent is explicit. The §5 dashboard surface is unchanged (still vendors/reviews/orders only).

5. **[NIT] `VendorContext` edit-function line references inconsistent.** Addressed. Standardized every reference to `updateVendorInfo`/`setPreorderEnabled` to a single range **`VendorContext.jsx:90-99`** across §1, §2, and §5 (was a mix of `87-101` and `90-99`). Verified: `updateVendorInfo` begins at line 90 and `setPreorderEnabled` at line 96; `isOpenNow` at 22-27 is cited correctly and left unchanged.

#### Revision 4 — two new user-approved changes (the changes these findings reviewed)

Revision 3 was **APPROVED** (its `design-verdict.json`: 0 HIGH / 0 MEDIUM / 3 NIT, all 3 NITs already folded into Rev 3). Revision 4 was **not** a review-loop revision at authoring time; it folded in two new decisions the user approved after that approval, keeping every prior decision intact except where these two require edits. (Revision 4 was then itself reviewed — see the 5 resolutions immediately above.)

**Change 1 — Admin role + admin dashboard (reverses the earlier "no admin" decision).** Folded in as follows:
- **Enum/roles:** `user_role` gains `admin` (lowercase); Overview and the Enums block state three roles and that `admin` is DB-assigned only (no signup path, not on the Signup form — verified `Signup.jsx:17,46-57` has exactly student/vendor).
- **Signup trigger guard:** §3 step 2 adds the privilege-escalation guard — `handle_new_user` coerces any client-supplied `role` that isn't exactly `'vendor'` to `'student'`, so `admin` can never be obtained via `signUp`. A new "Creating an admin" subsection documents the manual `UPDATE public.profiles SET role='admin' …` bootstrap (also in §6/§7).
- **RLS (every affected table):** §2 adds the "admin is an RLS superuser for content tables" rule and rewrites each policy as `<owner/role predicate> OR public.auth_role() = 'admin'`, with dedicated admin-only policies where the client verb was "none" (vendors INSERT/DELETE). Per-table admin access spelled out for `vendors`, `menu_items`, `orders`, `order_items`, `reviews`, `profiles`, `favorites`. The vendors column guard and the profiles role-immutability guard are both updated to **exempt an admin caller** (distinguished via `public.auth_role() = 'admin'`), so an admin can change another user's `role`/`owner_id` while `rating`/`review_count` stay unwritable by any client. Admin gets SELECT-all on orders but **no** order write (writes stay the C# service's).
- **Routes/nav:** §3 adds `/admin` under `RequireRole role="admin"` (added to `App.jsx:40-50`); `Header.jsx:18,47-53,55-60` extended so admins see an **Admin** link.
- **Admin dashboard surface:** §5 adds a dedicated subsection — `src/pages/Admin.jsx` with three panels (manage vendors incl. assign/change owner + toggle preorder + edit store; moderate/delete reviews; read-only all-orders view), stating which actions are direct-Supabase under admin RLS (all of them this pass) vs. the C# service (none), and that the vendor list reuses `VendorCard`'s badges/`categoryName` but not its `<Link>` click (`VendorCard.jsx:38`). §7 places this as **Phase B2** (new frontend work depending only on Phase A + Phase B wiring) and says so.
- **Open questions:** Q1 updated (admin = reactive moderation lever), Q4 updated (see Change 2). The audit's earlier "NO admin" framing is explicitly reversed.

**Change 2 — Seed vendors get pre-seeded fake-email owner accounts (claimable demo logins).** Folded in as follows:
- **Mechanism (chosen):** §5 specifies creating the 8 owners via the **Supabase service-role Admin API** (`supabase.auth.admin.createUser`, `email_confirm: true`) from a seed script, rejecting raw `INSERT INTO auth.users`. Emails are `<slug>@foodherons.local`; metadata carries `role: 'vendor'`, `store_name`, and a new `store_slug` key.
- **Trigger/ordering conflict (resolved):** §5 commits to **seed auth users first and let the `handle_new_user` trigger create each `vendors` row** (using `store_slug` as the canonical `id`, insert `ON CONFLICT (id) DO NOTHING`), then an `UPDATE` fills the remaining real columns. §3's trigger note documents the `store_slug`/`ON CONFLICT` additions. This gives exactly one writer per `vendors` row (no double-insert).
- **Shared password + tradeoff:** §6 documents the one shared demo password `FoodHerons!Demo2026`, the fake-email pattern, and labels it **demo-only / change before production**, acknowledging the shared-known-credential security tradeoff. The password is passed to the seed via `SEED_VENDOR_PASSWORD` (git-ignored).
- **Admin tie-in:** §5/§6/Q4 cross-reference that the admin dashboard's assign-owner action is the "claim" tool to re-point a seed vendor to a real account later.
- **Doc sites updated:** §1 vendors `owner_id` note, §5 seed plan (new demo-account bullet + rewritten vendors bullet), §6 getting-started, §7 Phase A done/verified (can log in as a seed vendor with the fake email + shared password and edit that store) and Phase B2 done/verified, and Open Question 4 (seed vendors now demo-owned, not owner-less).

No other prior decision was changed: `numeric(10,2)` prices, slug PKs, order-service scope (placement + transitions only), client-only cart, deferred account deletion, deferred Facebook, lowercase role casing, review snapshot triggers, `order_code_seq`, Asia/Manila openness, and the JWT validation approach are all untouched. This pass remains **design-only** — no `.sql`, no C# project scaffold, no app-code edits.

#### Status of the Revision-3 review's 3 NITs (verdict APPROVED — inline loose-ends, not blockers)

The **Revision-3** `design-review.md` / `design-verdict.json` returned **APPROVED** with **3 NITs** (0 HIGH / 0 MEDIUM), which the reviewer explicitly described as loose ends an implementer can close inline while coding Phase B — they do not block Phase A. (The later Rev-4 review's findings are handled in the first subsection above.) For completeness, these three were **not** folded into the prose (they are outside the two approved changes this pass is scoped to), so they remain open as implementation-time notes:
1. **Reviews → `ReviewsModal` field mapping** — when wiring `VendorStore.jsx`, map fetched rows to the shape `ReviewsModal.jsx` reads: `{ id, name: author_name, ordered: ordered_summary, rating, text, helpful: helpful_count, createdAt: created_at }`.
2. **Rating-breakdown bars** — omit the `breakdown` prop to `ReviewsModal`; it self-derives the bars from the passed reviews array (confirmed fallback in `ReviewsModal.jsx`), and the headline count stays sourced from `vendors.review_count`.
3. **Student-cancel UI wiring** — `OrderStatus.jsx`'s `handleCancel` posts `{ to: 'cancelled', reason: null }` to the transition endpoint; on 200 navigate to `/` (or show cancelled), on 409 `ILLEGAL_TRANSITION` show "this order can no longer be cancelled."

These three are captured here so they are not lost; implementing them is a Phase B coding task, not a design change.

#### Revision 3 (prior pass) — the 4 findings in that earlier review round

All 4 findings (1 HIGH, 1 MEDIUM, 2 NIT) from the latest `design-review.md` / `design-verdict.json` are **addressed**:

1. **[HIGH] Public store page cannot render a review's `ordered` string under the stated RLS policies** — Addressed by review's preferred option (a): snapshot the summary onto the review row. §1 adds `reviews.ordered_summary text NOT NULL DEFAULT ''`, filled by a `BEFORE INSERT SECURITY DEFINER` trigger (now `set_review_snapshot`, which also sets `author_name`) via `SELECT COALESCE(string_agg(qty || '× ' || name, ', '), '') FROM order_items WHERE order_id = NEW.order_id`. The public store page reads `ordered_summary` straight off the public `reviews` row and never touches `order_items`, so anonymous/non-owner viewers render the "Ordered:" line correctly. §2 keeps the `order_items` SELECT policy restrictive (option (b)'s public order_items read was rejected to avoid disclosing other students' item names/qtys/prices), and explicitly states the read-time join is replaced by the snapshot. The review-submit payload in §2, the §5 VendorStore rewire row, and the Phase A trigger list are all updated to `ordered_summary` / `set_review_snapshot`.

2. **[MEDIUM] `vendors.location_area` integrity left ambiguous** — Addressed by the review's preferred mechanism: a `location_areas(id text PK, name text NOT NULL, sort_order int)` lookup table, seeded from the six real values, with `vendors.location_area text NOT NULL REFERENCES location_areas(id)`. §1 now commits to the lookup table (not an either/or, not a CHECK), explains the choice (symmetry with `categories`; adding a campus area stays plain data; the FK makes an off-list value impossible so stores stay filterable), and notes the FK guards the vendor `UPDATE` path. The RLS table gains a public-SELECT `location_areas` row, the ER description gains the relationship, and Open Question entries note the resolution.

3. **[NIT] `locationAreas` not listed in the seed migration enumeration** — Addressed. §5 seed list adds a `location_areas` bullet stating the six values are re-homed into that table (seeded with `id = name = <value>` plus `sort_order`) and that the frontend location filter is sourced from it after `src/data/vendors.js` is deleted; the Home.jsx rewire row says the same. Phase A's migration/seed lines now include `location_areas`.

4. **[NIT] Line-number drift for `categoryName` import in §5 VendorStore row** — Addressed. Changed `categoryName (:5)` to `categoryName (:4)` in the VendorStore.jsx rewire row (verified: `import { categoryName } from '../data/vendors'` is on line 4; `getReviewsFor` on line 9 is unchanged).

#### Revision 2 (prior pass) — the 5 findings in that review

All 5 findings (2 MEDIUM, 3 NIT) from the latest `design-review.md` / `design-verdict.json` are **addressed**:

1. **[MEDIUM] `handle_new_user` reads metadata keys (`mobile`, `store_name`) the signup form doesn't define** — Addressed. §3 now pins the exact form-field → `user_metadata` key mapping with the explicit `supabase.auth.signUp` snippet: `full_name = form.name`, `mobile = form.phone`, `store_name = role === 'vendor' ? form.store : null`, `role` from the `role` useState. The trigger is stated to read exactly `raw_user_meta_data->>'full_name'/'role'/'mobile'/'store_name'`, with a note that a key mismatch silently stores NULL into `profiles.mobile`. Verified against `Signup.jsx:18` (`form` is `{ name, email, phone, password, store }`, `role` is a separate useState at `Signup.jsx:17`).

2. **[MEDIUM] Review submission flow unspecified (empty TODO stub; `order_id` source undefined)** — Addressed. §2 adds a concrete "Client review-submit flow": the two driving screens are `OrderStatus.jsx`'s completed-state "Leave a review" button (currently an empty `/* TODO */` `onClick`, confirmed in source) and the `Profile.jsx` `PENDING_REVIEWS` list; the insert payload is `{ vendor_id, order_id, rating, text }` with `student_id` filled by `DEFAULT auth.uid()` and `author_name` trigger-filled; `order_id` is the completed order's UUID carried from the order record. §5 VendorStore row and Phase B are updated to mark the store page read-only for reviews and route submission to those two screens.

3. **[NIT] `reviews.student_id` / `favorites.student_id` default unspecified** — Addressed. Both columns now declare `DEFAULT auth.uid()` in §1, with a note that the client never sends the student id and RLS `WITH CHECK (student_id = auth.uid())` still holds.

4. **[NIT] Profile `/login` redirect line off by one** — Addressed. §3 now cites `Profile.jsx:734` (the commented-out `// if (!auth.user) return <Navigate to="/login" replace />`), verified in source.

5. **[NIT] Signup-trigger vendor insert violates NOT NULL on `hours_open`/`hours_close`** — Addressed. Both columns now carry `NOT NULL DEFAULT '00:00'` in §1; §1's hours note and §3 step 2 explain that the trigger relies on the default and that a `00:00`–`00:00` store reads **closed** under `isOpenNow()` (non-wrap branch `m >= 0 && m < 0` is false for all minutes), which is the desired safe default until the owner sets real hours.

#### Revision 1 (prior pass) — recap of the 13 original findings

All 13 findings from the first `design-review.md` (verdict `CHANGES_REQUESTED`) were **addressed** in Revision 1 and remain resolved. Summary of each response:

1. **[MEDIUM] categories enum-vs-table contradiction** — Addressed. Deleted `menu_category` from the Enums block; `order_status` and `user_role` are now the only enums. §1 states once that categories are a lookup table `categories(id text PK, name NOT NULL, image, sort_order int DEFAULT 0)` and that `vendors.category`/`menu_items.category` are `text NOT NULL REFERENCES categories(id)`.

2. **[MEDIUM] menu_items PK wording** — Addressed. The `id` row now reads "part of composite PK `(vendor_id, id)`"; the Decision states the composite PK once and drops all "globally unique kept" clauses (with a parenthetical noting the data is in fact globally unique today, but composite is the committed rule).

3. **[MEDIUM] order_items FK question mark** — Addressed. The note now states flatly that `menu_item_id` and `vendor_id` are plain columns with NO FK to `menu_items`, `name`/`unit_price` are snapshots copied at insert, and the only FK is `order_id → orders` ON DELETE CASCADE. Removed the question mark and the SET NULL alternative.

4. **[MEDIUM] current_role() name + RLS recursion** — Addressed. Renamed to `public.auth_role()`, written once as `SECURITY DEFINER STABLE SET search_path = public` reading `profiles` with RLS bypassed, with the SQL body shown and an explanation of why it does not recurse. All policy rows reference `public.auth_role()`.

5. **[MEDIUM] profiles SELECT "?"** — Addressed. The SELECT cell now reads "own row only (`id = auth.uid()`); no public read" and the note resolves reviewer-name display to the `reviews.author_name` snapshot.

6. **[MEDIUM] missing reviews.author_name** — Addressed. Added `author_name text NOT NULL` to the §1 reviews table and specified a `BEFORE INSERT` `SECURITY DEFINER` trigger (`set_review_author_name`) that overwrites it from `profiles.full_name WHERE id = auth.uid()` so it cannot be spoofed.

7. **[MEDIUM] nullable order_id + uniqueness hole** — Addressed. `order_id` is now `uuid NOT NULL`; the unique `(student_id, vendor_id, order_id)` key is NULL-free and enforces one review per completed order; the ER line is now `orders 1───0..1 reviews`; and the INSERT `WITH CHECK` is expressed as the `EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.student_id = auth.uid() AND o.status = 'completed')` form in both the policy table and the note.

8. **[MEDIUM] missing server timezone for openness** — Addressed. §1 vendors note and §4 place-order auth now state the service evaluates openness in `Asia/Manila` (UTC+8, no DST), converting `DateTimeOffset.UtcNow` before comparing to `hours_open`/`hours_close`, and mirror the overnight-wrap logic of `isOpenNow()`.

9. **[MEDIUM] collision-prone order code** — Addressed. The `code` is now backed by a Postgres sequence `order_code_seq` as `'FH-' || lpad(nextval('order_code_seq')::text, 6, '0')`; §1 and §4 both state collisions are impossible and the retry loop is removed (also removed from the error-handling table).

10. **[MEDIUM] pickupName bound** — Addressed. Set to trimmed length 2–80; empty/whitespace-only and single-char rejected with 422; stated explicitly that the service does not fall back to the profile name.

11. **[NIT] .gitignore wording** — Addressed. §6 now says the file ignores `.env`, `.env.*`, and `*.local`, notes `.env.local` is doubly ignored, and states the `!.env.example` negations must be placed after the `.env.*` line to take effect.

12. **[NIT] student-cancel race** — Addressed. §4 now specifies transitions read current status `FOR UPDATE` inside the transaction and that a student cancel is accepted only if status is still `pending`, else 409 `ILLEGAL_TRANSITION`; Open Question 3 updated to reflect the enforced rule.

13. **[NIT] Phase C tests** — Addressed. Phase C now includes an xUnit `FoodHerons.Api.Tests` project covering `OrderService` total computation, the Asia/Manila openness evaluation, and the transition state machine, making `dotnet test` meaningful; noted the frontend has no test runner so Phase B uses `npm run build` + manual checks.

Non-defect items from the review's "Unverified / Wrong Assumptions" that are worth carrying forward (no design change required beyond notes already present): `pgcrypto`/`gen_random_uuid` availability is called out in Phase A; the trigger's `raw_user_meta_data` keys (`role`/`full_name`/`mobile`/`store_name`) are kept consistent with the signup `options.data` call in §3; and the JWT signing mode (HS256 vs JWKS) and audience/issuer strings remain Open Question 6, confirmed by the user at Phase C.
