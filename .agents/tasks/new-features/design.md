# FoodHerons — Admin approval, vendor revenue PDF, and GCash-gated pre-orders

Requirements + technical design for three new features in the FoodHerons UMAK
campus food app. All work targets the worktree
`c:\Users\paulc\Projects\FoodHerons\.worktrees\new-features` on branch
`feature/admin-revenue-gcash`.

**Revision 4.** The latest design review
(`.agents/tasks/new-features/design-review.md`) reviewed Revision 3 and returned
2 MEDIUM + 2 NIT findings. This pass folds all four in place; the
point-by-point responses are in **Part 8** (now Part 8a), with the Revision 3
and Revision 2 responses retained below them for history. The Revision 4
changes, folded directly into the sections below:

- an explicit SQL `payment_proofs_select_visible` SELECT policy in `0010`,
  pinning exactly three authorized reader classes (student owner / vendor owner
  of the order / admin) keyed off `split_part(name,'/',1)::uuid`, with the
  vendor-owner branch constrained to `vendors.owner_id = auth.uid()` so no
  vendor can sign another vendor's order screenshot (review Finding 1);
- a stated `OrdersPanel` write-scaffolding requirement in `Admin.jsx` — it must
  receive `onChanged`/`setError` props, import `transitionOrder`, and implement
  its own busy/reason/error handling (it cannot reuse `VendorRow.run`), with
  admin order writes going through the C# order service unlike every other
  admin write in that file (review Finding 2);
- the `StudentCancel` admin allowance scoped to ONLY the pre-payment from-states
  (`awaiting_payment`/`payment_submitted`), so an admin cannot cancel a plain
  `pending` order (review Finding 3);
- a single authoritative statement that `SubmitPaymentAsync` (the endpoint)
  performs the `screenshotPath` shape/route-id check (`{id}/{rest}`, non-empty
  `rest`), with the reference-string rules kept in the pure
  `ValidateSubmitPayment` (review Finding 4).

**Revision 3.** The preceding design review reviewed Revision 2 and returned
CHANGES_REQUESTED with 0 HIGH, 4 MEDIUM, and 2 NIT findings. That pass resolved
every one; its point-by-point responses are retained in Part 8. The substantive
Revision 3 changes, all folded into the sections below:

- vendor/admin **Cancel order** control on the Dashboard Payments panel and the
  Admin payment rows, wiring the legal `payment_submitted/awaiting_payment →
  cancelled` transitions a requirement already allowed but the UI did not expose
  (review Finding 1);
- an explicit student **Cancel order** control on the `awaiting_payment` branch
  of `OrderStatus.jsx` (not only `payment_submitted`), completing FR3.8 (review
  Finding 2);
- a single canonical `placedAt` on **both** the live and done dashboard rows and
  a stated per-day grouping key + timezone for the revenue PDF (review
  Finding 3);
- an explicit empty/loading state for the student payment step when the vendor's
  GCash details are unavailable, plus a pinned rule that the payment page uses
  the full-list `getVendor`, never `publicVendors` (review Finding 4);
- an operator procedure note in `supabase/README.md` that `0009` must be its own
  SQL-editor execution before `0010` (review Finding 5);
- a stated known limitation that the storage INSERT policy bounds *who* writes
  under an order prefix but not *how many* objects (review Finding 6).

(The earlier review before this one returned 3 HIGH / 4 MEDIUM / 3 NIT; those
fixes — the enum migration split, the `transition_order` overload/grant
handling, the `ApplyTransitionAsync` arity ripple and its six tests, the admin
Orders panel UUID gap, the three-bucket reason rule, the dedicated vendor GCash
field, and the 9-pair sync-test spec — are already folded in below and remain in
force.)

The three layers in play, with their locked stacks:

- **Database:** Supabase Postgres, migrations in `supabase/migrations/`
  numbered `0001`–`0007`. New changes go in **new** numbered files; this design
  adds exactly three: `0008_vendor_approval.sql`,
  `0009_order_payment_enum.sql` (enum `ADD VALUE` only — split out per review
  Finding 7 so the new labels are committed before first use), and
  `0010_order_payment.sql` (columns, default, storage, RPCs). Applied migrations
  are never edited. RLS + two
  Postgres enums (`user_role`, `order_status`) + `SECURITY DEFINER` helper
  functions and RPCs.
- **API:** .NET minimal API in `server/FoodHerons.Api/` (C#, `net8`-style
  minimal API, Npgsql-free HTTPS-to-PostgREST data layer). Build
  `dotnet build server/FoodHerons.sln`; test `dotnet test server/FoodHerons.sln`
  (xUnit).
- **Frontend:** React 18 + Vite 5 + React Router 6. Supabase JS client in
  `src/lib/supabase.js`; C# order-service helpers in `src/lib/api.js`. Design
  tokens in `src/styles/tokens.css`. Palette: two oranges, some yellows, mostly
  white, **no blue**; dark mode; mobile-first; accessible.

---

## Part 1 — Requirements

### 1.1 Summary

Three features, each already partially scaffolded, to be completed end to end:

1. **Admin approval + app management.** New vendor signups default to a
   `pending` approval status and are invisible/unorderable to students until an
   admin approves them. The existing `/admin` console (`src/pages/Admin.jsx`)
   gains an approval workflow (approve / reject / suspend / re-activate) plus
   the already-present user, store, and order management views. Privileged
   actions are authorization-checked server-side via RLS, not only hidden in
   the UI.
2. **Vendor revenue PDF export.** A vendor exports their own revenue as a
   client-side PDF from the dashboard, scoped strictly to the authenticated
   vendor's own orders (existing owner RLS), over a selectable date range, with
   a per-day breakdown and total.
3. **GCash-gated pre-orders.** The current "cash on pickup, order goes straight
   to the vendor queue" flow becomes: confirm → order created
   `awaiting_payment` (not in the vendor queue) → customer submits a GCash
   reference number (screenshot optional) → `payment_submitted` → vendor or
   admin manually verifies → order enters the normal queue (`pending` → …).
   Unverified orders never reach the active queue. Manual verification only; no
   payment gateway.

### 1.2 Functional requirements

**Feature 1 — Admin approval + management**

- FR1.1 New vendor stores are created with approval status `pending`.
- FR1.2 Students only see and can only order from `approved` stores. `pending`,
  `rejected`, and `suspended` stores are excluded from the public directory,
  search, and the store page order path.
- FR1.3 An admin can **approve** a `pending` store, **reject** a `pending`
  store, **suspend** an `approved` store, and **re-activate** (approve) a
  `rejected`/`suspended` store.
- FR1.4 The admin console surfaces a pending queue and a status filter, built on
  the existing `Admin.jsx` page (extend the Vendors panel; do not create a
  parallel page).
- FR1.5 Overall app management, scoped to: view/manage users + roles (the admin
  can change a user's role — already supported by `guard_profile_role` + RLS),
  view all stores, view all orders (both already present in `Admin.jsx`).
- FR1.6 A vendor whose store is not `approved` sees a clear "awaiting approval"
  / "suspended" state on their dashboard and cannot enable pre-ordering while
  not approved.
- FR1.7 All approval/suspension writes are authorized server-side (admin-only
  via RLS + a column guard); a non-admin cannot change a store's approval
  status.

**Feature 2 — Revenue PDF**

- FR2.1 The vendor dashboard offers an "Export revenue (PDF)" action.
- FR2.2 The report contains: store name, generation timestamp, the selected
  date range, a per-day breakdown (date, completed-order count, day revenue), a
  grand total revenue, and total completed-order count.
- FR2.3 Revenue counts **completed** orders only (matching the existing
  dashboard KPI definition: cancelled orders are excluded).
- FR2.4 Date range is selectable; default is "Last 30 days". Ranges mirror the
  existing dashboard ranges (Today / 7 / 30 / All time).
- FR2.5 Data is read only from the authenticated vendor's own orders; a vendor
  can never export another vendor's revenue (enforced by existing owner RLS on
  `orders`).
- FR2.6 PDF generation is client-side; no new server endpoint.

**Feature 3 — GCash-gated pre-orders**

- FR3.1 Placing a pre-order creates the order in a pre-queue state
  (`awaiting_payment`); it is not visible in the vendor's active order queue.
- FR3.2 After confirming, the student is taken to a payment step showing the
  vendor's GCash details and the amount, and must submit a GCash **reference
  number** (required). A screenshot is **optional**.
- FR3.3 Submitting payment proof moves the order to `payment_submitted`.
- FR3.4 A vendor or an admin manually verifies payment, moving the order to
  `pending` (entering the normal queue). From there the existing
  `pending → preparing → ready → completed` / `cancelled` machine is unchanged.
- FR3.5 A vendor or admin can reject payment, returning the order to
  `awaiting_payment` with a reason so the student can resubmit, or cancel it.
- FR3.6 An order that is not verified-paid can never be `preparing`/`ready`/
  `completed`.
- FR3.7 All order state writes continue to go only through the C# order service
  (service-role); the browser never writes `orders`/`order_items`. Payment
  reference/screenshot submission by the student is the one new student-driven
  order write and is handled through the order service too (see §4.3), not a
  direct Supabase write, to keep the "no client order writes" invariant.
- FR3.8 Student may cancel while `awaiting_payment` or `payment_submitted`.

### 1.3 Non-functional requirements

- NFR1 Match each layer's existing style, naming, and patterns (snake_case DB /
  camelCase UI mapping in `VendorContext`; `DomainError` + `ErrorCodes` in the
  API; direct-to-Supabase reads under RLS from the browser).
- NFR2 Respect the palette (oranges/yellows/white, no blue), dark mode, mobile
  first, and accessibility (labelled controls, `role="alert"` on errors, focus
  management on new dialogs) consistent with existing pages.
- NFR3 Reuse existing components, context, tokens, and the `Icon` set. Do not
  introduce a new UI framework or restyle.
- NFR4 New dependencies pinned to exact versions.
- NFR5 Keep the C# `OrderService.Legal` state machine and the SQL
  `transition_order` whitelist in sync; the existing sync test
  (`DbSupabaseTests.LegalTransitionSet_matches_0007_sql_whitelist`) must be
  updated and kept green.
- NFR6 README updated: remove "no approval step", document the GCash
  pre-payment flow and the revenue export.

### 1.4 Acceptance criteria

1. A freshly signed-up vendor's store has `approval_status = 'pending'` and does
   **not** appear in the student directory (`/`), search, or as orderable on its
   store page.
2. After an admin approves that store, it appears in the directory and students
   can place pre-orders against it.
3. A non-admin (student or vendor) attempting to set `approval_status` via a
   direct Supabase update is rejected by the DB (RLS/guard), returning an error;
   the store's status is unchanged.
4. Suspending an `approved` store removes it from the student directory
   immediately on next load; re-activating restores it.
5. On the vendor dashboard, "Export revenue (PDF)" downloads a PDF naming the
   store, the date range, each day's revenue, and a grand total that equals the
   sum of that vendor's **completed** orders in range.
6. The exported PDF for vendor A never contains vendor B's orders (verified by
   RLS: vendor A's session cannot read vendor B's orders).
7. Placing a pre-order creates an order with `status = 'awaiting_payment'`; it
   is absent from the vendor's Incoming-orders queue.
8. Submitting a GCash reference number moves the order to `payment_submitted`;
   submitting with an empty reference is rejected with a validation error.
9. A vendor verifying payment moves the order to `pending`, after which it
   appears in the Incoming queue; a direct attempt to transition
   `awaiting_payment → preparing` (skipping verification) is rejected with
   `ILLEGAL_TRANSITION`.
10. An unverified order (`awaiting_payment` or `payment_submitted`) is never
    shown in the active vendor queue and cannot be marked `ready`/`completed`.
11. `dotnet test server/FoodHerons.sln` passes, including the updated legal-set
    sync test and new payment-transition tests.
12. `npm run build` succeeds with the new dependency installed.
13. README no longer claims "no approval step" and documents both the GCash flow
    and the revenue export.
14. A vendor whose store has no `gcash_number` cannot enable pre-ordering (the
    Dashboard pre-order Switch is disabled with a hint); after setting a GCash
    number in Store info, the Switch becomes enabled. The student payment step
    on `awaiting_payment` displays the vendor's `gcash_name`/`gcash_number`, not
    the contact `phone`.
15. The admin Orders panel renders a Verify/Reject control for a
    `payment_submitted` order and the action succeeds (admin authorized via the
    `PaymentReview` branch), moving the order to `pending`/`awaiting_payment`;
    the admin "View screenshot" opens a signed URL when a proof exists.
16. `dotnet build server/FoodHerons.sln` compiles after the
    `ApplyTransitionAsync` signature change — all six existing
    `ApplyTransitionAsync` tests and the endpoint call site pass the new `actor`
    argument.
17. A student viewing an `awaiting_payment` order sees a "Cancel order" control;
    using it (with a reason) moves the order to `cancelled`. The same control is
    present and works on a `payment_submitted` order. (FR3.8 fully wired.)
18. A vendor (on the Dashboard Payments panel) and an admin (on the Admin Orders
    panel) each see a "Cancel order" control on `payment_submitted` and
    `awaiting_payment` orders; using it (with a reason) moves the order to
    `cancelled`. (FR3.5 "or cancel it".)
19. When a vendor's store has no `gcash_number` or the vendor record is
    unavailable, the student payment step shows a "payment details unavailable"
    message and no submit form or blank GCash fields — it never renders an empty
    destination number.
20. The exported revenue PDF groups and dates every in-range completed order by
    its `placed_at` (not by "days ago"), so a completed-today order and an older
    completed order appear on their correct calendar days, and the PDF prints the
    day-boundary basis.

### 1.5 Out of scope

- Any real/online payment gateway or automated GCash verification.
- Refunds, partial payments, or payment reconciliation reporting.
- Email/SMS/push notifications on approval or payment events.
- Admin-side revenue analytics or cross-vendor reporting PDFs.
- Changing the existing `pending → … → completed` vendor queue machine beyond
  adding the pre-queue states.
- Server-side PDF generation.

---

## Part 2 — Feature 1: Admin approval + app management

### 2.1 Overview

Approval is a new closed domain on the `vendors` table. Because the existing
code already treats `vendors` as publicly selectable and admin-writable, the
cleanest fit is a new enum column `approval_status` on `vendors` plus a new RLS
predicate that narrows the **student-facing** read to approved stores while
leaving owner and admin reads unrestricted. Approval transitions are
admin-only, enforced in a new BEFORE-UPDATE column guard that mirrors the
existing `guard_vendor_columns` pattern. The admin UI extends the existing
Vendors panel in `Admin.jsx`; no parallel page.

### 2.2 Technology / decisions

- **New enum vs text + check.** The codebase uses a true Postgres enum for
  closed domains (`user_role`, `order_status`) and text + FK for open lookups.
  Approval status is a small closed domain, so use a **new enum**
  `public.vendor_approval_status` with values
  `('pending', 'approved', 'rejected', 'suspended')`. Chosen over a text+check
  column to match `0002_enums.sql` precedent and to get the same
  `transition_order`-style guarding ergonomics.
- **Default + backfill.** New column `vendors.approval_status` NOT NULL DEFAULT
  `'pending'`. The 8 seed/demo stores and any existing real stores must remain
  visible, so the migration backfills **all existing rows to `'approved'`**
  (they predate approval). The DEFAULT then makes every *new* signup `pending`.
  Rationale: the user asked that new signups require approval; retroactively
  hiding the already-live demo stores would break the running app.
- **Signup trigger.** `handle_new_user` in `0004` inserts the vendor row with no
  `approval_status`, so the column DEFAULT `'pending'` applies automatically —
  no trigger change needed. (Confirmed: the trigger's vendor INSERT lists only
  `id, owner_id, name`.)
- **GCash receiving account — DECISION (Rev-2 review Finding 4).** The vendor row has
  a `phone` *contact* column (confirmed in `0003_tables.sql`) but **no** payment
  field. Silently reusing `phone` as the GCash-receiving number is a
  correctness/trust defect: a contact number is not necessarily the GCash
  account, and there is no account-name to display. Decision: add two dedicated
  nullable columns on `vendors` in `0008` — `gcash_number text` and
  `gcash_name text` — map them through `VendorContext.mapVendor`, add them to
  the Dashboard store-info editor (via the existing `updateVendorInfo` patch
  path), and **gate pre-order enablement on `gcash_number` being set** (a vendor
  cannot turn on pre-ordering, and the student payment step is not reachable,
  until a GCash number exists). Rejected alternative: "GCash number = contact
  phone" — simpler but conflates two distinct fields and would show students a
  possibly-wrong destination for real money. The dedicated-field choice is small
  (two nullable text columns, no enum, reuses the existing owner-update path) and
  removes the ambiguity the review flagged.
- **Who may change status.** Admin only. Enforced two ways (defense in depth):
  the existing `vendors_update_owner_or_admin` policy already lets an owner
  UPDATE their row, so a new BEFORE-UPDATE guard rejects any `approval_status`
  change unless `public.auth_role() = 'admin'` (same shape as the
  `owner_id`-admin-only rule already in `guard_vendor_columns`).

### 2.3 Database changes — `supabase/migrations/0008_vendor_approval.sql`

New migration, run after `0007`. Contents:

1. **Enum:** create `public.vendor_approval_status` guarded by the same
   `do $$ ... if not exists (select 1 from pg_type ...)` idempotency block used
   in `0002_enums.sql`.
2. **Column:**
   ```sql
   alter table public.vendors
     add column if not exists approval_status public.vendor_approval_status
       not null default 'pending';
   ```
   Then backfill existing rows:
   ```sql
   update public.vendors set approval_status = 'approved'
     where approval_status = 'pending';
   ```
   (Runs once; new signups created after this migration default to `pending`.)
   Add index: `create index if not exists vendors_approval_status_idx on
   public.vendors (approval_status);`
   Also add the GCash receiving-account columns (Rev-2 review Finding 4):
   ```sql
   alter table public.vendors
     add column if not exists gcash_number text,
     add column if not exists gcash_name   text;
   ```
   Both nullable; no default. Existing/demo stores keep NULL (they have no GCash
   set yet) — which, with the pre-order gate below, means a demo vendor must set
   a GCash number before pre-ordering works against it. Acceptable: the seed
   vendors are demo data and the gate is the intended behavior.
3. **Extend the column guard.** `create or replace function
   public.guard_vendor_columns()` — re-declare the whole function (it already
   lives in `0004`; re-creating in `0008` is additive and safe, and keeps all
   guard logic current) adding, after the existing service-role early return and
   rating/owner checks:
   ```sql
   if new.approval_status is distinct from old.approval_status
      and public.auth_role() <> 'admin' then
     raise exception 'approval_status can only be changed by an admin';
   end if;
   ```
   Keep the existing `rating/review_count` and `owner_id` guards intact.
4. **RLS read narrowing.** The current `vendors_select_all` policy is
   `using (true)`. Replace it so students only see approved stores while owners
   and admins see their own/all:
   ```sql
   drop policy if exists vendors_select_all on public.vendors;
   create policy vendors_select_approved_or_privileged on public.vendors
     for select using (
       approval_status = 'approved'
       or owner_id = auth.uid()
       or public.auth_role() = 'admin'
     );
   ```
   Note on anon: the public directory is read with the anon key, and
   `auth.uid()` is null for anon, so anon sees only `approved` stores — exactly
   the student-facing requirement. Confirmed `menu_items`/`reviews` keep their
   `using (true)` SELECT; a hidden store's menu rows are technically still
   readable directly, but the directory/search/store-page all key off the
   `vendors` list (see §2.5), so a non-approved store is not reachable through
   the UI. This is acceptable for the stated scope (we are gating discovery and
   ordering, not hardening every table against direct API enumeration); noted as
   a known limitation rather than over-building menu/review RLS.
5. **Grants:** none needed (no new RPC in this feature; admin writes go through
   the existing authenticated-client UPDATE policy).

Migration ordering invariant: `0008` depends on `0004` (guard function) and
`0005` (the policy it replaces) already applied. `0009` (enum add) must be
applied and committed before `0010` (which uses the new labels). The supabase
README's apply order gets the three new steps in order `0008 → 0009 → 0010`.

### 2.4 API changes

**None required.** Approval writes are a plain `vendors` UPDATE from the admin's
authenticated browser session under the admin RLS branch — the same mechanism
`Admin.jsx` already uses for `owner_id`/`preorder_enabled`. Adding an admin-only
API endpoint would duplicate an authorization boundary the DB already owns. The
invariant "approval only by admin" is owned by the **DB layer** (RLS +
`guard_vendor_columns`) because that is where every other vendor-column
privilege rule already lives; putting it in the API too would create two
sources of truth. Decision: DB-only enforcement, matching precedent.

### 2.5 Frontend changes

**`src/context/VendorContext.jsx`** — map the new columns and filter the public
list:

- In `mapVendor`, add `approvalStatus: r.approval_status`,
  `gcashNumber: r.gcash_number`, and `gcashName: r.gcash_name`.
- In `updateVendorInfo`, extend the patch builder with
  `if (info.gcashNumber !== undefined) patch.gcash_number = info.gcashNumber`
  and the analogous `gcash_name` line (mirroring the existing `phone` handling),
  so the Dashboard editor can persist them under the owner-update RLS branch
  (these are owner-editable, not admin-gated — no `guard_vendor_columns`
  change). The vendors read is `select('*')`, so the new columns flow through
  automatically.
- The `vendors` memo currently returns every row. Because admin reads now also
  return non-approved stores (owner/admin RLS branch), add a derived
  `publicVendors` = `vendors.filter(v => v.approvalStatus === 'approved')` and
  export it. Student-facing consumers switch to `publicVendors`.
- Keep `currentVendorId` and `getVendor` working off the full `vendors` list so
  a vendor can still load their own (possibly pending) store in the dashboard,
  and so `getVendor` can resolve a store referenced by an existing order.
- **Pinned invariant (Rev-3 review Finding 4):** `getVendor` MUST stay bound to the
  full `vendors` list, **not** `publicVendors`. The student payment step
  (`OrderStatus.jsx`, §4.5) resolves the vendor's GCash details through
  `getVendor(order.vendorId)`; if that were switched to `publicVendors`, a store
  suspended *after* an order was placed would stop resolving and the student
  could no longer see where to pay for an order they already committed to. The
  public directory/search exclusion is achieved by having those surfaces consume
  `publicVendors` (below), not by narrowing `getVendor`. This one-line rule is
  stated so a later edit does not "simplify" `getVendor` onto the filtered list
  and silently break the in-flight payment path.

**`src/pages/Home.jsx`** and **`src/pages/Search.jsx`** — consume
`publicVendors` instead of `vendors` for the directory, category results, stats,
and search index. (Home uses `vendors` in `VendorResults`, `categoryVendors`,
`openCount`, and the hero stats; swap each to `publicVendors`.)

**`src/pages/VendorStore.jsx`** — a direct link to a non-approved store should
not be orderable. Add: if `getVendor(id)` is undefined (student/anon RLS hid it)
the page already shows "not found"; additionally, for a resolved store whose
`approvalStatus !== 'approved'`, force `canOrder = false` and show the existing
`store-note` style message ("This vendor isn't available right now."). This
covers the owner viewing their own pending store.

**`src/pages/Admin.jsx`** — extend the existing **Vendors panel** (do not add a
parallel page):

- Add an approval status filter row to the Vendors panel (chips: All / Pending /
  Approved / Rejected / Suspended), reusing the existing `.chip`/`.admin-tab`
  styles.
- In `VendorRow`, add a status badge (reuse the `badge` classes; map
  pending→`badge--preorder` tint, approved→`badge--open`, rejected/suspended→
  `badge--closed` — no new colors, all from existing tokens) and a control group
  with buttons whose visibility depends on current status:
  - `pending`: **Approve**, **Reject**
  - `approved`: **Suspend**
  - `rejected` / `suspended`: **Re-activate** (sets `approved`)
- Each button calls the existing `run(() => supabase.from('vendors')
  .update({ approval_status: '<next>' }).eq('id', vendor.id))` helper already in
  `VendorRow`. No new client lib code.
- The Vendors panel's tab count can additionally show a pending count badge.

**Dashboard awaiting-approval + GCash gate** (`src/pages/Dashboard.jsx`): the
pre-order Switch is rendered in the dashboard and wired through the local
wrapper `const setPreorder = (on) => setPreorderEnabled(vid, on)` (which calls
`VendorContext.setPreorderEnabled`; Rev-2 review Finding 9 — name it precisely, the
guard belongs at the Switch, not in the context method). Gate the Switch two
ways (FR1.6 + Rev-2 review Finding 4):

- When `vendor.approvalStatus !== 'approved'`, render an informational banner
  (reuse the `dashboard-empty` block) explaining the store is awaiting approval
  / suspended, and **disable** the pre-order Switch so `setPreorder(true)`
  cannot be invoked.
- When `!vendor.gcashNumber`, disable the Switch with a hint ("Add your GCash
  number in Store info to enable pre-ordering") so a vendor cannot accept
  pre-orders with no payment destination. Add the `gcashNumber`/`gcashName`
  inputs to the store-info editor tab (reuse `.field`/`.input`, placed next to
  the existing `phone` field), persisted via `updateVendorInfo`.

The store/menu editing tabs stay usable while not approved so the vendor can
prepare their store (including setting GCash details). The student-facing path
is independently safe: a non-approved store is excluded from `publicVendors`, so
even a forced-on toggle cannot expose ordering.

### 2.6 Validation, edge cases, errors (Feature 1)

- **Invalid status value:** impossible from the UI (buttons send fixed
  literals); a hand-crafted bad value is rejected by the enum cast at the DB,
  surfaced as a Supabase error string already handled by `Admin.jsx`'s
  `setError`.
- **Non-admin write attempt:** `guard_vendor_columns` raises; the
  `.update(...)` returns `{ error }`, shown via the existing error path. State
  unchanged (recoverable; not logged server-side beyond Postgres).
- **Owner edits their store while pending:** allowed for non-status columns (the
  guard only blocks the `approval_status` column); the owner RLS SELECT branch
  lets them keep viewing/editing.
- **Pre-order toggle while not approved:** disabled in UI; even if forced, an
  unapproved store is excluded from `publicVendors` so students still can't
  order. Belt-and-suspenders acceptable.

### 2.7 Testability (Feature 1)

- DB: manual/SQL-editor checks in the supabase verification checklist — anon
  SELECT returns only approved stores; a student JWT UPDATE of `approval_status`
  is rejected; an admin JWT UPDATE succeeds. (No automated DB test harness
  exists; follows the existing Phase-A manual-verification convention.)
- Frontend: the filtering is pure (`publicVendors` derivation) and could be unit
  tested if a frontend test runner is added later; none exists today, so verify
  via `npm run build` + manual click-through. Do not add a frontend test
  framework for this.

---

## Part 3 — Feature 2: Vendor revenue PDF

### 3.1 Overview

A client-side PDF built with `jspdf` + `jspdf-autotable`, triggered from the
vendor dashboard. The dashboard already loads the vendor's own orders
(`loadOrders` in `Dashboard.jsx`) and already computes revenue from completed
orders in the `DashboardTab`. The export reuses that same data and definition;
it does not call any new endpoint and does not read any other vendor's data
(owner RLS on `orders`).

### 3.2 Technology / decisions

- **Library + exact versions.** Add to `dependencies` in `package.json`, pinned
  exactly (no caret):
  - `"jspdf": "2.5.2"`
  - `"jspdf-autotable": "3.8.4"` (compatible with jspdf 2.5.x; the 3.x line
    targets jspdf 2.x).
  Rationale: jspdf 2.5.2 is the last stable 2.x; jspdf-autotable 3.8.4 is the
  matching table plugin. Pinned per NFR4. A CSV export already exists in
  `Dashboard.jsx` (`exportReport`), so PDF is an additive sibling, not a
  replacement.
- **Client-side vs server.** Client-side chosen (FR2.6) because all the data is
  already in the browser under RLS, there is no server read endpoint for orders
  (reads are direct-to-Supabase by design), and generating server-side would
  require a new authenticated endpoint plus a PDF toolchain in .NET — out of
  proportion to the task.
- **Placement.** New module `src/lib/revenuePdf.js` holding the pure
  `buildRevenuePdf({ storeName, range, rows })` function (returns a jsPDF doc),
  so the DOM-free report construction is unit-testable and the dashboard only
  wires a click handler. Mirrors the existing separation (pure logic vs
  component).

### 3.3 Data

Source rows: the dashboard already has `allHistory` (completed/cancelled with
`daysAgo`, `total`, `status`, `id`, `name`, `items`). Reuse it. The export:

- Filters by the selected range (`daysAgo <= max`, using the same `RANGES`
  table) and `status === 'completed'`.
- Groups by calendar day — see the canonical-date rule below.
- Per day: count of completed orders and summed `total`.
- Grand total: sum of all in-range completed `total`; total count.

**Canonical date for grouping (Rev-3 review Finding 3).** The existing rows are
inconsistent: `loadOrders`'s `done.push({ ..., daysAgo: daysAgoFrom(o.placed_at) })`
carries `daysAgo` but **no** `placedAt`, while `live.push({ ..., placedAt:
Date.parse(o.placed_at) })` carries `placedAt` but no `daysAgo`; and `allHistory`
prepends completed-today *live* orders mapped with `daysAgo: 0` and no
`placedAt`. So neither field is present on every completed row, and the PDF
cannot reliably print a real date or group uniformly. Fix, in two parts:

1. **One canonical field on both buckets.** Extend `loadOrders` so **both**
   `done.push` and `live.push` set `placedAt: Date.parse(o.placed_at)` (the live
   bucket already does; add it to the done bucket). Keep `daysAgo` on the done
   rows (it still drives the existing day-grouped history view and the range
   filter). The `allHistory` memo's completed-today spread
   (`...orders.filter(...).map((o) => ({ ...o, daysAgo: 0 }))`) then already
   carries `placedAt` from the live row, so every completed row in `allHistory`
   has a `placedAt`. Net: `placedAt` (epoch ms) is the single source of truth for
   "which calendar day" in the PDF; `daysAgo` stays only as the range-filter and
   on-screen grouping key.

2. **Stated grouping key + timezone.** `buildRevenuePdf` derives each row's
   per-day key from that one `placedAt` via
   `new Date(placedAt).toLocaleDateString('en-PH')`, i.e. the day boundary is the
   **browser's local midnight rendered in the `en-PH` locale**. For the intended
   UMAK/PH audience this is Asia/Manila in practice, but because
   `toLocaleDateString` uses the *browser's* timezone, the PDF header prints an
   explicit "Day boundary: your device's local time" line so the grouping rule is
   unambiguous and never silently attributed to a fixed server zone. The per-day
   display label in the PDF is the same `toLocaleDateString('en-PH', { weekday,
   month, day, year })` formatting family the dashboard's `dayLabel` already uses,
   for visual consistency. No reliance on `daysAgo` for the printed date — only
   the canonical `placedAt`.

### 3.4 Frontend changes

**`src/lib/revenuePdf.js`** (new):
```
export function buildRevenuePdf({ storeName, rangeLabel, generatedAt, days, grandTotal, orderCount }) {
  // new jsPDF(); header (store name, "Revenue report", rangeLabel, generatedAt,
  //   and a "Day boundary: your device's local time" line — Rev-3 review Finding 3);
  // autoTable with columns [Date, Completed orders, Revenue (PHP)];
  // footer row / summary block with orderCount + grandTotal; return doc
}
```
`days` is the per-day aggregation the caller builds from the in-range completed
orders, keyed by `new Date(placedAt).toLocaleDateString('en-PH')` (§3.3). Expose
the aggregation as a named helper (e.g. `aggregateByDay(orders)`) so it is
unit-testable in isolation; `buildRevenuePdf` itself only lays out the already
aggregated `days`.
No peso glyph in PDF (jsPDF core fonts lack ₱); print amounts as `PHP 1,234.00`
to avoid font embedding. Numbers formatted with `toLocaleString('en-PH')`.

**`src/pages/Dashboard.jsx`** — in `DashboardTab` (which already owns the range
state and revenue computation), add an "Export PDF" button next to the existing
toolbar, styled with `dashboard-btn dashboard-btn--outline` and the `download`
icon (already in the `Icon` set). Handler:
- Take the already-filtered `inRange` completed orders and build the per-day
  aggregation with `aggregateByDay`, keyed by each order's canonical `placedAt`
  (now present on every completed row per §3.3), not `daysAgo`.
- Call `buildRevenuePdf(...)` and `doc.save('revenue-' + range + '.pdf')`.
- `flash('Revenue report downloaded')` using the existing toast.

The existing `AccountTab.exportReport` CSV stays; the account-deletion dialog's
"Export sales report" link is unchanged.

### 3.5 Validation, edge cases, errors (Feature 2)

- **Empty range (no completed orders):** produce a valid PDF with a single
  "No completed orders in this range" line and a zero total; do not throw.
- **Vendor with no store yet:** the Dashboard already guards `if (!vendor)` and
  shows "store not found"; the export button lives inside `DashboardTab`, only
  rendered when a store exists.
- **jsPDF import/runtime failure:** wrap the handler in try/catch; on failure
  `flash('Could not generate the PDF. Please try again.')` (recoverable,
  user-facing, not fatal). Console.error for diagnostics, matching existing
  error logging style.
- **Large history (All time):** autoTable paginates automatically; acceptable.
- **Amount formatting:** `Number(total)` already normalized in `loadOrders`;
  guard `Number(x) || 0`.

### 3.6 Testability (Feature 2)

- `buildRevenuePdf` is pure (no DOM) and the per-day aggregation helper can be
  extracted and unit tested if/when a frontend runner exists. Today: verify via
  `npm run build` and manual download + open. The aggregation helper should be a
  named export so it is testable in isolation later.

---

## Part 4 — Feature 3: GCash-gated pre-orders

### 4.1 Overview

Two new states precede the existing `pending` queue. Placement now creates an
order `awaiting_payment` instead of `pending`. The student submits a GCash
reference (and optional screenshot); the order moves to `payment_submitted`. A
vendor or admin verifies, moving it to `pending` — the entry point of the
existing unchanged machine. The order service (C#) remains the sole writer of
`orders`, so the new transitions are added to `OrderService.Legal`, the SQL
`transition_order` whitelist, the authorization routing, and the payment-column
update logic. Payment-proof submission is a **new order-service endpoint** so
the browser still never writes `orders` directly.

### 4.2 Decisions

- **New enum values.** Extend `public.order_status` with `'awaiting_payment'`
  and `'payment_submitted'` (Postgres `ALTER TYPE ... ADD VALUE`). These sort
  after existing values; ordering does not matter since the app keys off value
  equality. **These live in their own migration `0009_order_payment_enum.sql`**
  (Rev-2 review Finding 7): Postgres forbids *using* a newly added enum label in the
  same transaction that added it, and the `0010` migration both sets a column
  DEFAULT to `'awaiting_payment'` and references the labels inside RPC bodies.
  Splitting the `ADD VALUE` into its own file that is applied and committed
  first makes this robust regardless of how the SQL editor batches statements.
  The two `add value if not exists` statements are bare top-of-file statements
  (they cannot run inside an explicit `begin…commit`).
- **New columns on `orders`** (migration `0010_order_payment.sql`):
  - `payment_method text not null default 'gcash'` — forward-looking label;
    only `'gcash'` used now.
  - `gcash_reference text` — the student-entered reference number.
  - `payment_screenshot_path text` — Supabase Storage object path (nullable;
    optional proof). Stores the path, not a public URL.
  - `payment_verified_at timestamptz` — set when a vendor/admin verifies.
  - `payment_verified_by uuid references public.profiles(id)` — who verified.
  - `payment_rejected_reason text` — populated on a payment rejection.
  - `payment_submitted_at timestamptz` — set when the student submits proof.
  Default status: change the `orders.status` column DEFAULT from `'pending'` to
  `'awaiting_payment'` so the `place_order` RPC (which does not pass status)
  creates orders awaiting payment. (Confirmed `place_order` omits `status`,
  relying on the column default.)
- **Screenshot storage — DECISION.** Use **Supabase Storage with a private
  bucket `payment-proofs`**, and make the screenshot **optional** (reference
  number is the required proof). Rationale and the rejected alternative:
  - *Rejected: reference-number-only, no upload.* Simpler, but manual verifiers
    frequently need the screenshot to confirm the GCash transaction, and the
    user's request explicitly lists "screenshot OPTIONAL" — implying it must be
    *possible*. So we support upload but don't require it.
  - *Rejected: base64 data URL in a text column.* The app already stores menu/
    logo images as base64 data URLs (Dashboard `readImage`), which is fine for
    small vendor-controlled images, but payment screenshots are
    student-uploaded, unbounded, and would bloat the `orders` row and every
    order read. Rejected for payload size and because order reads happen
    frequently (status polling).
  - *Chosen: private Storage bucket.* Keeps the `orders` row small (just a
    path), keeps screenshots access-controlled (only the owning student, the
    vendor owner, and admins get signed-URL access), and matches how a growing
    app should handle user uploads. This is the only place in the codebase that
    introduces Supabase Storage; the bucket + policies are defined in the new
    migration so the decision is self-contained.
  - Bucket is **private**; the vendor/admin views a screenshot via a short-lived
    signed URL created with `supabase.storage.from('payment-proofs')
    .createSignedUrl(path, 60)`.
- **New state machine (authoritative in C# `OrderService`):**
  - `awaiting_payment → payment_submitted` — student submits proof.
  - `payment_submitted → pending` — vendor/admin verifies (payment accepted).
  - `payment_submitted → awaiting_payment` — vendor/admin rejects proof (reason
    required); student can resubmit.
  - `awaiting_payment → cancelled` — student or vendor cancels (reason required).
  - `payment_submitted → cancelled` — student or vendor cancels.
  - Existing pairs unchanged: `pending→preparing`, `preparing→ready`,
    `ready→completed`, `pending→cancelled`, `preparing→cancelled`.
  - No pair allows reaching `preparing`/`ready`/`completed` from a pre-payment
    state, satisfying FR3.6/AC9/AC10.
- **Payment submission as a new transition vs a dedicated endpoint.** The
  reference number and optional screenshot path are data, not just a status
  flip, so a plain `transition` body can't carry them cleanly. Decision: add a
  dedicated `POST /api/orders/{id}/payment` endpoint that validates the
  reference, writes the payment columns, and performs the
  `awaiting_payment → payment_submitted` move atomically via a new RPC. The
  verify/reject actions reuse the existing `transition` endpoint (they are pure
  status moves with a reason), with the verify move additionally stamping
  `payment_verified_at/by` inside the RPC.

### 4.3 Database changes — enum split + `0010_order_payment.sql`

**`supabase/migrations/0009_order_payment_enum.sql`** (Rev-2 review Finding 7) — the
two enum additions ONLY, as bare autocommitted statements, run and committed
before `0010`:
```sql
alter type public.order_status add value if not exists 'awaiting_payment';
alter type public.order_status add value if not exists 'payment_submitted';
```
No other statements in this file. This guarantees the labels exist and are
committed before anything in `0010` uses them (as a column DEFAULT or inside an
RPC body), avoiding the `unsafe use of new value` error that would otherwise be
submission-order-dependent.

**`supabase/migrations/0010_order_payment.sql`** — run after `0009`. Contents:

1. **(enum values already added in `0009` — nothing to do here.)**
2. **Columns:** `alter table public.orders add column if not exists ...` for the
   seven columns in §4.2, plus change the status default:
   ```sql
   alter table public.orders alter column status set default 'awaiting_payment';
   ```
3. **Storage bucket + policies:**
   ```sql
   insert into storage.buckets (id, name, public)
   values ('payment-proofs', 'payment-proofs', false)
   on conflict (id) do nothing;
   ```
   RLS policies on `storage.objects` scoped to this bucket. Object path
   convention: `<order_id>/<filename>`. Policies:
   - INSERT (upload) allowed to the authenticated student who owns the order
     referenced by the first path segment:
     ```sql
     create policy payment_proofs_insert_owner on storage.objects
       for insert to authenticated with check (
         bucket_id = 'payment-proofs'
         and exists (
           select 1 from public.orders o
            where o.id = (split_part(name, '/', 1))::uuid
              and o.student_id = auth.uid()
         )
       );
     ```
   - SELECT (read, for signed URLs) allowed to exactly three authorized reader
     classes — the owning student, the vendor owner of the order, or an admin —
     keyed off the same `split_part(name, '/', 1)::uuid` order-id derivation the
     INSERT policy uses, pinned as explicit SQL (Rev-4 review Finding 1):
     ```sql
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
     ```
     The vendor-owner branch is constrained to `v.owner_id = auth.uid()` (joined
     through the order's own `vendor_id`), so no vendor can sign a URL for
     another vendor's order screenshot — the branch only matches the vendor that
     actually owns the order referenced by the path. This is pinned as full SQL,
     the same way the INSERT policy is, so the three authorized reader classes
     (student owner / vendor owner / admin) are unambiguous and not left to
     interpretation.
   - No UPDATE/DELETE policies (proofs are immutable once uploaded; acceptable).
   **Known limitation (Rev-3 review Finding 6):** the INSERT policy constrains *who*
   may write under an order prefix (only the student who owns the order named in
   the first path segment) but not *how many* objects, and the second path
   segment (`<filename>`) is unconstrained client input. So a student could
   upload arbitrarily many objects under their own `<order_id>/<any name>`
   prefix. This is bounded to the student's own order prefixes, never surfaced
   (only the single path stored on the order row is ever signed and shown to the
   vendor/admin — see the SELECT policy), and with no UPDATE/DELETE policy the
   objects are immutable. Accepted for scope, like the menu/review-RLS note in
   §2.3 step 4; no per-prefix object cap is added.
   The bucket insert is idempotent (`on conflict do nothing`). **External
   dependency (review note):** `0010` writes to `storage.buckets` /
   `storage.objects`, which exist on a hosted Supabase project but NOT on a bare
   Postgres. This matches the project's hosted model (reads already go through
   PostgREST); the supabase verification checklist states this prerequisite so
   an implementer applying against bare Postgres is not surprised.
4. **New RPC `submit_payment`** (SECURITY DEFINER, service-role only, same
   revoke/guard pattern as `place_order`):
   ```sql
   create or replace function public.submit_payment(
     p_id uuid, p_reference text, p_screenshot_path text
   ) returns public.orders ...
   ```
   Locks the order `for update`; if its status is not `awaiting_payment` raise
   `FH001` (illegal); set `gcash_reference`, `payment_screenshot_path`,
   `payment_submitted_at = now()`, `status = 'payment_submitted'`; return the
   row. Raise `FH002` if not found. Mirrors `transition_order`'s error-code
   contract.
5. **Extend `transition_order` — and handle the overload + grants (review
   Finding 1).** The function gains a `p_actor uuid` parameter so
   `payment_verified_by` can be stamped. Adding a parameter creates a **new
   overload** `(uuid, text, text, uuid)`; `create or replace` does NOT drop the
   old 3-arg `(uuid, text, text)` function, and the existing `0007` REVOKEs
   target the old 3-arg signature only — so the new overload would be left with
   default PUBLIC/anon/authenticated EXECUTE. The migration must therefore:
   - `create or replace function public.transition_order(p_id uuid, p_to text,
     p_reason text, p_actor uuid) returns public.orders ...`. **Parameter order
     is fixed as `(p_id, p_to, p_reason, p_actor)`** — `p_actor` is last, after
     `p_reason`. (The C# `TransitionRpcBody` serializes by `p_*` name so JSON
     order is irrelevant, but the drop/revoke statements and any positional
     default handling are order-sensitive, so the order is pinned here.)
   - add pairs to the whitelist (verbatim mirror of `OrderService.Legal`):
     `('payment_submitted','pending')`,
     `('payment_submitted','awaiting_payment')`,
     `('awaiting_payment','cancelled')`, `('payment_submitted','cancelled')`.
   - in the UPDATE, set `payment_verified_at = case when p_to='pending' then
     now() else payment_verified_at end`, `payment_verified_by = case when
     p_to='pending' then p_actor else payment_verified_by end`,
     `payment_submitted_at` unchanged here (set by `submit_payment`), and
     `payment_rejected_reason = case when p_to='awaiting_payment' then p_reason
     else payment_rejected_reason end`. Keep the existing status/timestamp
     CASE lines.
   - **Drop the stale overload and lock down the new one:**
     ```sql
     drop function if exists public.transition_order(uuid, text, text);
     revoke all on function public.transition_order(uuid, text, text, uuid) from public;
     do $$
     begin
       if exists (select from pg_roles where rolname in ('anon','authenticated')) then
         revoke all on function public.transition_order(uuid, text, text, uuid) from anon, authenticated;
       end if;
     end$$;
     ```
     The `drop` removes the orphaned 3-arg function (nothing calls it any more —
     the C# layer moves to the 4-arg body); the revokes target the new 4-arg
     signature explicitly, matching the guarded pattern `0007`/`place_order`
     already uses.
6. **Grants for `submit_payment`:** revoke from `public`/`anon`/`authenticated`
   (guarded `do $$` block, same shape as `place_order`), on the exact signature
   `public.submit_payment(uuid, text, text)`.

### 4.4 API changes (`server/FoodHerons.Api/`)

**`Services/OrderDomain.cs`:**
- Add to `OrderStatuses`: `AwaitingPayment = "awaiting_payment"`,
  `PaymentSubmitted = "payment_submitted"`, and include both in `All`.
- `TransitionKind` gains a case for payment verification/rejection routing, or
  reuse `VendorAction` (verify/reject are vendor-or-admin actions). Add a new
  kind `PaymentReview` so authorization can allow **admin as well as the vendor
  owner** (verify/reject). Student cancels from pre-payment states map to
  `StudentCancel`.

**`Services/OrderService.cs`:**
- Extend `Legal` with the four new pairs (§4.2).
- `PlanTransition` classification:
  - `payment_submitted → pending` and `payment_submitted → awaiting_payment`
    → `PaymentReview` (vendor owner or admin).
  - `awaiting_payment → cancelled`, `payment_submitted → cancelled`
    → `StudentCancel` (student owner, or vendor owner, or admin — same pattern
    as the existing `pending → cancelled`).
- `ValidateTransition` — **three buckets, exact predicate (Rev-2 review Finding 5).**
  The current code is a two-way `isCancel` branch; the rewrite must distinguish
  reason-required (`cancelled`, `awaiting_payment`), reason-forbidden (`pending`,
  `preparing`, `ready`, `completed`), and must NOT allow a reason on the verify
  (`→ pending`) move. Concrete predicate:
  ```csharp
  if (!OrderStatuses.IsValid(request.To))
      return Invalid("to", "to must be a valid order status.");

  var reasonRequired =
      request.To is OrderStatuses.Cancelled or OrderStatuses.AwaitingPayment;
  var reason = request.Reason?.Trim();

  if (reasonRequired && string.IsNullOrWhiteSpace(reason))
      return Invalid("reason", "reason is required when cancelling or rejecting payment.");
  if (!reasonRequired && !string.IsNullOrEmpty(request.Reason))
      return Invalid("reason", "reason is only allowed when cancelling or rejecting payment.");
  if (reason is not null && reason.Length > ReasonMax)
      return Invalid("reason", $"reason must be at most {ReasonMax} characters.");
  return null;
  ```
  Keep `ReasonMax`. Note `payment_submitted → pending` (verify) falls in the
  forbidden bucket, so a reason on verify is rejected — matching the UI call in
  §4.5 (`transitionOrder(uuid, { to: 'pending' })`, no reason).
- New `ValidateSubmitPayment(SubmitPaymentRequest)` — the **pure service** owns
  only the reference-string rules: `gcashReference` required, trimmed length
  bounds (e.g. 4–40 chars, digits/spaces/hyphens — define `GcashRefMin=4`,
  `GcashRefMax=40`). Return a `VALIDATION` `DomainError` with a `field` detail on
  failure. The `screenshotPath` shape/route-id check is **not** performed here
  (it needs the route id); it is pinned authoritatively at the endpoint — see
  the single authoritative statement in the `SubmitPaymentAsync` bullet below
  (Rev-4 review Finding 4).

**`Dtos/OrderDtos.cs`:**
- `SubmitPaymentRequest(string? GcashReference, string? ScreenshotPath)`.
- Extend `OrderDto` and `PlaceOrderResponse` with the payment fields the UI
  needs: `PaymentStatus`/`gcashReference`? Minimal addition: add
  `GcashReference`, `PaymentSubmittedAt`, `PaymentVerifiedAt`,
  `PaymentRejectedReason`, `PaymentScreenshotPath` to `OrderDto` so the vendor
  verification view and the student status page can render state. (These are
  read-only projections.)

**`Data/Db.cs`:**
- Add `SubmitPaymentAsync(Guid id, string reference, string? screenshotPath,
  CancellationToken)` posting to `rpc/submit_payment`, same response/err mapping
  as the other RPCs (`FH001 → ILLEGAL_TRANSITION`, `FH002 → NOT_FOUND`).
- **`TransitionRpcBody` + `ApplyTransitionAsync` arity (Rev-2 review Finding 2).** Add
  a `[property: JsonPropertyName("p_actor")] Guid Actor` to the
  `TransitionRpcBody` record and thread the caller through
  `ApplyTransitionAsync`. **Final signature:**
  `ApplyTransitionAsync(OrderService orderService, Guid orderId, string to,
  string? reason, Guid actor, CancellationToken ct)` — the new `actor` goes
  **after `reason`, before `ct`** (matches the SQL `p_actor`-last ordering and
  keeps `ct` last per the codebase convention). The body is built as
  `new TransitionRpcBody(orderId, to, reason, actor)`. This is a breaking
  signature change with two ripple sites that MUST be updated in the same change
  or the test project will not compile:
  1. **Endpoint call site** in `Endpoints/OrdersEndpoints.cs`
     (`TransitionAsync`): pass `userId.Value` as the new `actor` arg.
  2. **Six existing tests** in `DbSupabaseTests.cs` that call the old 5-arg
     shape — add the actor argument (e.g. `Guid.NewGuid()`) to each:
     `ApplyTransitionAsync_success_returns_ok`,
     `ApplyTransitionAsync_FH001_maps_to_illegal_transition`,
     `ApplyTransitionAsync_FH002_maps_to_not_found`,
     `ApplyTransitionAsync_maps_FH001_regardless_of_http_status`,
     `ApplyTransitionAsync_unknown_error_code_throws`,
     `ApplyTransitionAsync_unparseable_error_body_throws`.
  Also add one assertion (in `ApplyTransitionAsync_success_returns_ok`) that the
  serialized body carries `p_actor` equal to the passed actor, so the new
  parameter is pinned by a test.
- Extend `OrderRowDto`/`OrderStateDto` with the new payment columns so
  `GetOrderStateAsync` and the RPC responses carry them; add the fields to
  `OrderRow` and `ToOrderRow`.

**`Endpoints/OrdersEndpoints.cs`:**
- New `group.MapPost("/orders/{id:guid}/payment", SubmitPaymentAsync)`.
  `SubmitPaymentAsync`: require auth; require caller role `student`; load order
  state; require `state.StudentId == userId`; run the pure
  `ValidateSubmitPayment` for the reference-string rules; then perform the
  **authoritative endpoint-side screenshot-path check**; call
  `db.SubmitPaymentAsync`; return the updated `OrderDto`. Errors via existing
  `FromDomainError`/`ServerError`.
- **Screenshot-path validation — pinned once, authoritatively (Rev-4 review
  Finding 4).** This check lives in `SubmitPaymentAsync` (the endpoint), NOT the
  pure `ValidateSubmitPayment`, because it needs the route GUID. Rule: when
  `request.ScreenshotPath` is non-null, reject with `422 VALIDATION`
  `field=screenshotPath` unless `ScreenshotPath == $"{id}/{rest}"` where `id` is
  the route GUID and `rest` is non-empty (i.e. the path's first `/`-segment
  equals the route order id and there is a non-empty remainder after it). A null
  `ScreenshotPath` is accepted (screenshot optional). This is the single
  authoritative statement of where that check runs and what it returns; the
  reference-string rules stay in the pure `ValidateSubmitPayment`. (This
  supersedes the two slightly-different earlier phrasings; §4.6's
  `screenshotPath` entry defers to this rule.)
- `TransitionAsync`: extend authorization — `PaymentReview` kind is authorized
  for the vendor owner **or** admin (`http.User.GetRole() == "admin"`). The
  existing `VendorAction` branch stays vendor-owner-only. `StudentCancel` already
  allows student owner or vendor owner; add the admin allowance **only for the
  two pre-payment from-states** (Rev-4 review Finding 3): authorize admin in the
  `StudentCancel` branch only when `plan.From is OrderStatuses.AwaitingPayment or
  OrderStatuses.PaymentSubmitted`. This deliberately does NOT let an admin cancel
  a plain `pending` order (which `PlanTransition` also classifies as
  `StudentCancel`) — admin cancel is scoped to the pre-payment lifecycle
  (FR3.5), not the normal queue. Student owner and vendor owner authorization on
  that branch is unchanged. Pass `userId` into `ApplyTransitionAsync` for
  `p_actor`.
- Admin role is read from the JWT via the existing
  `SupabasePrincipal.GetRole()` (already supports `app_metadata.role`).

**Tests (`server/FoodHerons.Api.Tests/`):**
- **`DbSupabaseTests` sync test — exact 9-pair set + rename (Rev-2 review
  Finding 6).** Rename `LegalTransitionSet_matches_0007_sql_whitelist` to
  `LegalTransitionSet_matches_sql_whitelist` and update its doc comment to cite
  **`0010_order_payment.sql`** (the `create or replace transition_order` that
  now carries the effective whitelist) rather than `0007`. The hard-coded
  `sqlWhitelist` becomes exactly these **9 pairs**:
  ```
  (pending,           preparing)
  (preparing,         ready)
  (ready,             completed)
  (pending,           cancelled)
  (preparing,         cancelled)
  (payment_submitted, pending)
  (payment_submitted, awaiting_payment)
  (awaiting_payment,  cancelled)
  (payment_submitted, cancelled)
  ```
  Keep it asserting the SQL whitelist equals `OrderService.Legal`. Its
  `illegalSamples` must stay all-illegal after the change — use
  `awaiting_payment → preparing`, `payment_submitted → ready`,
  `awaiting_payment → completed`; do **not** leave any now-legal pair (e.g.
  `payment_submitted → pending`) in the illegal list.
- **`OrderServiceTransitionTests` — add legal pairs, audit illegal cases
  (Rev-2 review Finding 6).** Add the four new legal pairs to the
  `Legal_transitions_allowed` `[Theory]` rows, and add new illegal `[InlineData]`
  rows (`awaiting_payment → preparing`, `payment_submitted → ready`,
  `awaiting_payment → completed`). **Grep the existing `Illegal_transitions_
  rejected` rows and confirm none of the four new legal pairs appears there** —
  the current rows (`preparing→pending`, `ready→preparing`, `completed→ready`,
  `pending→ready`, `pending→completed`, `preparing→completed`,
  `completed→cancelled`, `completed→preparing`, `cancelled→pending`,
  `cancelled→preparing`, `ready→cancelled`) do NOT, so no removals are needed,
  but the audit is a required step so a future edit can't silently assert a
  now-legal pair as illegal. Also add classification tests:
  `payment_submitted → pending`/`→ awaiting_payment` classify as
  `PaymentReview`; `awaiting_payment → cancelled` / `payment_submitted →
  cancelled` classify as `StudentCancel`.
- New `OrderServicePaymentTests`: `ValidateSubmitPayment` required/empty/too-long
  reference, screenshot optional, valid case.
- New `DbSupabaseTests` cases for `SubmitPaymentAsync` success + FH001/FH002
  mapping, mirroring the existing RPC test style with the stub handler.
- `ValidateTransition` tests belong in the **existing
  `OrderServiceValidationTests.cs`** (Rev-2 review Finding 8 — that file already owns
  the reason-rule tests; do not create a parallel file for them). Add: reason
  required for `→ cancelled` and `→ awaiting_payment` (rejection); reason
  forbidden (and thus rejected) for `→ pending` (verify) and the other forward
  moves; over-length reason rejected. Keep the new *payment-request* validation
  (`ValidateSubmitPayment`) in the new `OrderServicePaymentTests.cs`; the
  split is: transition reason-rules → `OrderServiceValidationTests.cs`,
  submit-payment body rules → `OrderServicePaymentTests.cs`.

### 4.5 Frontend changes

**`src/lib/api.js`:**
- `postOrder` unchanged (still returns the created order; status is now
  `awaiting_payment`).
- Add `submitPayment(id, { gcashReference, screenshotPath })` →
  `POST /orders/{id}/payment`.
- `transitionOrder` already generic; vendor verify/reject call it with
  `{ to: 'pending' }` / `{ to: 'awaiting_payment', reason }`.

**`src/pages/Cart.jsx`:**
- Replace the "Pay cash upon pickup" copy and `checkout__pay` block. On
  successful `postOrder`, instead of going straight to `/order/:id`, navigate to
  the order page which now shows the payment step for an `awaiting_payment`
  order (keeps one source of truth for the payment UI on the order page). Update
  the confirm button copy and `.checkout__fine` note to say payment via GCash is
  required next. No new route needed.

**`src/pages/OrderStatus.jsx`** — the natural home for the payment step (the
student already lands here and it polls status):
- Add UI states for `awaiting_payment` and `payment_submitted` to `STATE_UI`
  and a leading tracker step ("Payment") before "Pending". Map
  `awaiting_payment`/`payment_submitted` in `DB_STATUS_TO_STEP`.
- `awaiting_payment`: resolve the vendor via the **full-list** `getVendor(
  order.vendorId)` (never `publicVendors` — pinned in §2.5, Rev-3 review Finding 4),
  then branch on whether its GCash details are present:
  - **Payment-details-unavailable state (Rev-3 review Finding 4).** If `vendor` is
    `undefined` (VendorContext still loading, or the store was removed) **or**
    `vendor.gcashNumber` is falsy, do **not** render the submit form or blank
    destination fields. Instead render an explicit message using the existing
    `order-review__error`/`store-note` styling: "This vendor's payment details
    are unavailable right now. Please contact the vendor before paying." This
    prevents a student from sending money to an empty/blank GCash field. (A
    vendor cannot enable pre-ordering without a `gcash_number` per §2.5, so this
    branch is primarily the loading/suspended-mid-flow case, but it is handled
    explicitly rather than assumed away.)
  - **Normal state.** When `vendor.gcashNumber` is present, show the vendor's
    **dedicated GCash details** (`vendor.gcashName` and `vendor.gcashNumber` from
    the new columns in §2.2, NOT `vendor.phone`; Rev-2 review Finding 4), plus a static
    "Send exactly ₱{total} via GCash to the number above" instruction, and a
    form: a **required** reference-number input and an **optional** screenshot
    file input. On submit:
    - If a screenshot is chosen, upload it first:
      `supabase.storage.from('payment-proofs').upload(`${order.uuid}/${filename}`,
      file)` (path begins with the order id to satisfy the storage policy). On
      success, pass the returned path to `submitPayment`.
    - Call `submitPayment(order.uuid, { gcashReference, screenshotPath })`;
      refresh the order.
  - **Cancel control (Rev-3 review Finding 2, FR3.8).** The `awaiting_payment` branch
    ALSO renders a "Cancel order" control (alongside / below the payment form)
    that calls `transitionOrder(order.uuid, { to: 'cancelled', reason })` with a
    prompted, required reason (reuse the existing `cancelOrder` handler's
    reason-prompt pattern already in the file). Without this, the legal
    `awaiting_payment → cancelled` student transition (classified `StudentCancel`
    in §4.4) has no entry point, since the existing cancel button renders only on
    the `pending` step. This makes FR3.8 fully wired for `awaiting_payment`, not
    just `payment_submitted`.
- `payment_submitted`: show "Payment submitted, waiting for the vendor to
  confirm" with the reference shown; render a "Cancel order" control that calls
  `transitionOrder(order.uuid, { to: 'cancelled', reason })` (prompted required
  reason) — the legal `payment_submitted → cancelled` move (Rev-3 review Finding 2,
  FR3.8). If the vendor rejected (status back to `awaiting_payment` with
  `payment_rejected_reason`), show the reason and let the student resubmit (the
  student then re-enters the `awaiting_payment` branch above).

Because both pre-payment branches now render their own cancel control, the
existing `isPending`-only cancel button is left unchanged (it keeps serving the
`pending` step). The new controls reuse the one `cancelOrder` reason-prompt
handler so there is a single student-cancel code path.
- The student order read (`fetchOrder`) must also select the new payment columns
  (`gcash_reference, payment_submitted_at, payment_rejected_reason, status`) —
  extend the `select`.

**`src/pages/Dashboard.jsx`** — new pre-queue surface:
- `loadOrders` currently buckets into `orders` (live: not completed/cancelled)
  and `history`. `awaiting_payment`/`payment_submitted` must **not** enter the
  Incoming queue (`OrdersTab` filters by `STATUS_ORDER` = pending/preparing/
  ready/completed, so they already won't show — good, satisfies FR3.1/AC7).
  Add a separate `payments` bucket for `payment_submitted` orders and a new
  "Payments" tab (or a section atop Incoming) listing them with: pickup name,
  total, GCash reference, a "View screenshot" link (signed URL), and
  **Verify payment** / **Reject** / **Cancel order** buttons.
  - Verify → `transitionOrder(uuid, { to: 'pending' })` then `loadOrders`.
  - Reject → prompt reason → `transitionOrder(uuid, { to: 'awaiting_payment',
    reason })`.
  - **Cancel order (Rev-3 review Finding 1, FR3.5).** Prompt a required reason →
    `transitionOrder(uuid, { to: 'cancelled', reason })` then `loadOrders`. This
    wires the legal `payment_submitted → cancelled` transition for the vendor
    owner (classified `StudentCancel` in §4.4, which authorizes student owner,
    vendor owner, or admin). Without this control, FR3.5's "or cancel it" and the
    legal transition pair had no vendor-side UI entry point.
  - `awaiting_payment` orders (student hasn't paid yet) are not Verify/Reject
    actionable by the vendor, but the vendor CAN cancel them: show them in a
    muted "Awaiting payment" group with a single **Cancel order** button →
    prompt reason → `transitionOrder(uuid, { to: 'cancelled', reason })` (the
    legal `awaiting_payment → cancelled` pair, Rev-3 review Finding 1). No
    Verify/Reject appears for them (there is no submitted proof yet).
- Extend the `loadOrders` select to include `gcash_reference,
  payment_screenshot_path`.
- Add `placedAt: Date.parse(o.placed_at)` to the **`done.push`** mapping as well
  (the `live.push` already has it) so every completed row carries a canonical
  `placedAt` for the revenue PDF's per-day grouping (§3.3, Rev-3 review Finding 3);
  keep `daysAgo` on the done rows for the existing history grouping and range
  filter.
- "View screenshot": `supabase.storage.from('payment-proofs')
  .createSignedUrl(path, 60)` then open in a new tab; handle the null-path case
  ("No screenshot provided").

**`src/pages/Admin.jsx`** — admin verify/reject of `payment_submitted` orders
(FR3.4 allows vendor *or* admin). **Rev-2 review Finding 3:** the panel currently
cannot do this — `loadAll` reads orders with
`select('code, vendor_id, status, pickup_name, subtotal, total, placed_at')`
(no `id`), and `OrdersPanel` renders rows keyed by `o.code`, so there is no
UUID to pass to `transitionOrder(id, …)`. The fix is required, not optional:

- Extend the admin orders SELECT to:
  `select('id, code, vendor_id, status, pickup_name, subtotal, total,
  placed_at, gcash_reference, payment_screenshot_path')`.
- Key `OrdersPanel` rows by `o.id` (keep showing `o.code` as the display label).
- **`OrdersPanel` write scaffolding — must be built, cannot be reused (Rev-4
  review Finding 2).** As written today, `OrdersPanel` is a read-only table: it
  does NOT import `transitionOrder`, holds no busy/error state, and the `run()`
  async-write helper (busy + `setError` + re-fetch) lives inside `VendorRow` in
  the Vendors panel and is NOT reachable from `OrdersPanel`. So `OrdersPanel`
  must grow its own write path, mirroring how `VendorsPanel`/`ReviewsPanel` are
  wired: it must receive `onChanged` (= `loadAll`) and `setError` props from the
  page, `import { transitionOrder } from '../lib/api'`, and implement its own
  per-row busy/disabled state, a reason prompt for the reject/cancel actions, and
  error surfacing via the page-level `setError`, refreshing with `onChanged()`
  (= `loadAll`) on success. It cannot call `VendorRow.run` (scoped to the Vendors
  panel, and that helper writes via `supabase.from('vendors')`, not the order
  service). **Note explicitly:** these admin order writes go through the **C#
  order service** (`transitionOrder` in `../lib/api`), unlike every other admin
  write in `Admin.jsx`, which goes through `supabase.from(...)` directly.
- For a `payment_submitted` row, render **Verify** → `transitionOrder(o.id,
  { to: 'pending' })`, **Reject** → prompt reason →
  `transitionOrder(o.id, { to: 'awaiting_payment', reason })`, and **Cancel
  order** → prompt required reason → `transitionOrder(o.id, { to: 'cancelled',
  reason })`, then `loadAll()`. The Cancel control (Rev-3 review Finding 1, FR3.5)
  gives the admin the same authorized `payment_submitted → cancelled` path the
  vendor has (classified `StudentCancel`, which authorizes admin). Admin is
  authorized server-side via the `PaymentReview` branch for verify/reject and
  the `StudentCancel` branch for cancel (§4.4); the UI button is not the security
  boundary.
- For an `awaiting_payment` row, render a **Cancel order** control only (prompt
  required reason → `transitionOrder(o.id, { to: 'cancelled', reason })`),
  matching the Dashboard's awaiting-payment cancel — no Verify/Reject since no
  proof exists yet.
- "View screenshot": when `payment_screenshot_path` is non-null,
  `supabase.storage.from('payment-proofs').createSignedUrl(path, 60)` then open
  in a new tab (same helper as the Dashboard; null-path → "No screenshot
  provided"). The admin SELECT now carries `gcash_reference` and
  `payment_screenshot_path` for this.
- Non-`payment_submitted` rows stay read-only, as today.

**Styling:** reuse `dashboard-badge--*`, `badge`, `dashboard-action--*`,
`.chip`, `order-*` classes. Add status styles for the two new statuses by
extending existing status-color maps (`admin-status--awaiting_payment`,
`dashboard-badge--payment_submitted`, etc.) using existing orange/yellow tokens,
no blue. The payment form on the order page reuses `.field`/`.input`/`.textarea`
and the `.btn--primary` styles.

### 4.6 Validation, inputs, errors (Feature 3)

Per external input:

- **`gcashReference`** (student, `POST /payment`): required; trimmed; length
  4–40; allowed chars digits/space/hyphen (lenient — GCash references are
  numeric but copy-paste may add spaces). On failure → `422 VALIDATION`,
  `field: "gcashReference"`. Recoverable; shown inline on the order page.
- **`screenshotPath`** (student): optional. Validated authoritatively in
  `SubmitPaymentAsync` (the endpoint) per the single pinned rule in §4.4: if
  non-null, it must equal `$"{id}/{rest}"` with the route GUID as the first
  segment and a non-empty `rest`, else `422 VALIDATION`, `field:
  "screenshotPath"`. This prevents a student attaching a path under another
  order. The file upload itself is further constrained by the storage INSERT
  policy (student must own the order in the path). File type/size: client
  restricts to images and ~5MB before upload (reuse the `readImage`/type-check
  idea, but upload the raw file to Storage, not a data URL).
- **`to`** (transition): must be a valid `order_status`; already validated. New
  values accepted.
- **`reason`**: required for `→ cancelled` and `→ awaiting_payment`; forbidden
  otherwise; ≤ `ReasonMax`.

Failure conditions per operation:

- **Place order** (unchanged path): vendor closed/unavailable → `409
  VENDOR_CLOSED`; item gone → `422 ITEM_UNAVAILABLE`; DB failure → sanitized
  `500 INTERNAL` with correlationId (existing behavior). Order now lands
  `awaiting_payment`.
- **Submit payment:** order not found → `404 NOT_FOUND`; order not in
  `awaiting_payment` (e.g. already submitted, lost race) → `409
  ILLEGAL_TRANSITION` (from RPC `FH001`); caller not the owning student → `403
  FORBIDDEN`; DB failure → `500`. The RPC logs nothing; the endpoint logs a
  warning on 403 and an error on 500 with correlationId, matching
  `OrdersEndpoints` conventions.
- **Verify/reject payment** (transition): illegal from-state → `409
  ILLEGAL_TRANSITION`; not authorized (not vendor owner nor admin) → `403`;
  not found → `404`. Reject without reason → `422 VALIDATION`.
- **Screenshot upload (client → Storage):** on upload error, surface inline
  ("Couldn't upload your screenshot; you can submit the reference number
  without it.") and let the student proceed reference-only (screenshot is
  optional). Recoverable.
- **Signed URL (vendor/admin):** on failure show "Couldn't open the screenshot."
  Recoverable; non-fatal.

Invariant ownership:

- "Unpaid order never in active queue" is owned by the **C# state machine +
  SQL whitelist** (no legal pair reaches `preparing` except from `pending`,
  which is only reachable from `payment_submitted` via verify). The DB `FOR
  UPDATE` re-check in `transition_order` is the authoritative lost-race guard.
- "Only the owning student submits payment" is owned by the **API endpoint**
  (role + ownership check) *and* the **Storage INSERT policy** (defense in
  depth).
- "Only vendor owner/admin verifies" is owned by the **API authorization
  routing** (`PaymentReview` kind). Orders table has no client write policy, so
  the DB can't independently enforce actor identity on the transition — hence
  the API owns it, consistent with the existing transition authorization model.

### 4.7 Edge cases (Feature 3)

- Student submits payment twice quickly: second call finds status
  `payment_submitted`, RPC raises `FH001` → `409`; UI refreshes.
- Vendor verifies while student is mid-resubmit: `FOR UPDATE` serializes; one
  wins, the other gets `ILLEGAL_TRANSITION` and the UI refreshes (same pattern
  as the existing accept/cancel race).
- Order cancelled from `awaiting_payment`: never counted in revenue (revenue =
  completed only), never in queue. Consistent.
- Screenshot uploaded but `submit_payment` then fails: an orphan object may
  remain in Storage under `<order_id>/`. **Deliberate ordering (review Finding
  10):** upload-then-submit is the chosen order, not an accident. Rationale: the
  Storage INSERT policy checks `orders.student_id = auth.uid()` for the order in
  the path, so the upload is already authorized before `submit_payment` runs;
  inverting to submit-then-upload would move the proof write ahead of the status
  flip and leave a `payment_submitted` order briefly claiming a screenshot that
  isn't uploaded yet. The orphan is bounded (one object under the order's own
  prefix), never surfaced (only orders whose row references the path get a signed
  URL), and acceptable for scope (no cleanup job). The client submits
  reference-only if the upload fails (screenshot is optional).
- Existing in-flight orders at migration time are `pending`/`preparing`/etc.
  (pre-payment feature); the new column defaults/NULLs don't affect them and
  they flow through the unchanged tail of the machine. Only *new* orders start
  `awaiting_payment`.

### 4.8 Testability (Feature 3)

- Unit (xUnit, existing harness): state-machine pairs, validation rules, the
  SQL/`OrderService.Legal` sync test, `SubmitPaymentAsync` RPC request/response
  + error mapping via the stub handler. All DB-free, run under
  `dotnet test server/FoodHerons.sln`.
- Integration: the Storage policies and the RPCs are verified manually in the
  Supabase SQL editor / app (no automated DB/integration harness exists today),
  added to the supabase verification checklist: student submits & sees
  `payment_submitted`; vendor verify → `pending` appears in queue; skip attempt
  rejected; screenshot signed-URL access limited to owner/vendor/admin.
- Frontend: verified via `npm run build` + manual click-through; the payment UI
  reuses tested components.

---

## Part 5 — Cross-cutting: README + migration order

- **`README.md`** (worktree root):
  - Pages table: `/signup` row — change "no approval step" to note vendor stores
    require admin approval before appearing. `/dashboard` — mention pre-order
    verification + revenue export. Add `/admin` row (admin console: approvals,
    users, orders).
  - "Notes": replace "No online payment — orders are reservations settled in
    cash at pickup" with the GCash pre-payment flow (manual verification, no
    gateway). Add a line about client-side revenue PDF export.
- **`supabase/README.md`**: add apply steps in order for
  `0008_vendor_approval.sql`, `0009_order_payment_enum.sql`, and
  `0010_order_payment.sql`, calling out that `0009` (enum add) must be applied
  and committed before `0010`. **Operator procedure (Rev-3 review Finding 5):** state
  explicitly — "Run `0009_order_payment_enum.sql` as its own SQL-editor
  execution and let it finish before pasting/running `0010` — do not paste both
  files into a single run." The Supabase SQL editor wraps a multi-statement run
  in one transaction, so the file split alone is not enough; the commit boundary
  the enum-add relies on is only guaranteed if the operator runs `0009`
  separately from `0010`. Note the new `payment-proofs` private bucket, the
  requirement that the project has the Supabase `storage` schema (hosted), the
  one-time backfill behavior (existing stores auto-approved), and that vendors
  must set a GCash number before pre-ordering works.

## Part 6 — File change inventory

New files:
- `supabase/migrations/0008_vendor_approval.sql` (approval enum/column/RLS +
  guard + `gcash_number`/`gcash_name` columns)
- `supabase/migrations/0009_order_payment_enum.sql` (two `ALTER TYPE … ADD
  VALUE` only — split per review Finding 7)
- `supabase/migrations/0010_order_payment.sql` (columns, status default,
  storage bucket + policies, `submit_payment`, `transition_order` overload +
  grants)
- `src/lib/revenuePdf.js`
- `server/FoodHerons.Api.Tests/OrderServicePaymentTests.cs`

Modified files:
- DB docs: `supabase/README.md`; root `README.md`
- API: `Services/OrderDomain.cs`, `Services/OrderService.cs`, `Dtos/OrderDtos.cs`,
  `Data/Db.cs`, `Endpoints/OrdersEndpoints.cs`
- API tests: `DbSupabaseTests.cs`, `OrderServiceTransitionTests.cs`,
  `OrderServiceValidationTests.cs` (reason rules)
- Frontend: `src/context/VendorContext.jsx`, `src/pages/Home.jsx`,
  `src/pages/Search.jsx`, `src/pages/VendorStore.jsx`, `src/pages/Admin.jsx`,
  `src/pages/Admin.css`, `src/pages/Dashboard.jsx`, `src/pages/Dashboard.css`,
  `src/pages/Cart.jsx`, `src/pages/OrderStatus.jsx`, `src/pages/OrderStatus.css`,
  `src/lib/api.js`, `package.json`

## Part 7 — Build / verify commands

- `dotnet build server/FoodHerons.sln` then `dotnet test server/FoodHerons.sln`
  (run from the worktree root).
- `npm install` (after pinning jspdf deps), then `npm run build`.
- Supabase migrations applied in order `0001 … 0008 → 0009 → 0010` in the SQL
  editor per the updated `supabase/README.md` (apply and commit `0009` before
  `0010`).

## Part 8 — Review responses

### Part 8a — Review responses (Revision 4, current)

The latest review (`.agents/tasks/new-features/design-review.md`) reviewed
Revision 3 and returned 2 MEDIUM (Findings 1–2) + 2 NIT (Findings 3–4). Every
finding is **addressed** below; none is backlogged or ignored, and each fix was
checked against the original authoritative request (admin approval + management;
vendor revenue PDF; GCash-gated manual pre-order) and the Part 1 requirements so
none contradicts them. The review's Verified Assumptions all still hold.

- **Finding 1 [MEDIUM] — storage `payment-proofs` SELECT policy was prose-only,
  a security boundary left to interpretation.** ADDRESSED in §4.3 step 3: the
  `payment_proofs_select_visible` policy is now pinned as explicit SQL, keyed off
  `split_part(name,'/',1)::uuid` (matching the verbatim INSERT policy), with
  exactly three authorized reader classes — student owner (`orders.student_id =
  auth.uid()`), vendor owner (join `vendors` where `v.id = o.vendor_id and
  v.owner_id = auth.uid()`), and `public.auth_role() = 'admin'`. The vendor-owner
  branch is constrained through the order's own `vendor_id` to the vendor with
  `owner_id = auth.uid()`, so no vendor can sign a URL for another vendor's order
  screenshot.

- **Finding 2 [MEDIUM] — admin `OrdersPanel` has no write scaffolding; `run()`
  lives in `VendorRow` and is not reusable.** ADDRESSED in §4.5 (`Admin.jsx`): it
  now states that `OrdersPanel` must receive `onChanged` (= `loadAll`) and
  `setError` props like `VendorsPanel`/`ReviewsPanel`, import `transitionOrder`
  from `../lib/api`, and implement its own per-row busy/reason/error handling for
  Verify/Reject/Cancel (it cannot reuse `VendorRow.run`). It also notes
  explicitly that admin order writes go through the C# order service, unlike
  every other admin write in that file, which goes through `supabase.from(...)`.

- **Finding 3 [NIT] — widening `StudentCancel` to admins also lets an admin
  cancel a plain `pending` order.** ADDRESSED in §4.4 (`OrdersEndpoints.cs`):
  chose option (b). The admin allowance on the `StudentCancel` branch is scoped
  to ONLY the pre-payment from-states — authorized when `plan.From is
  OrderStatuses.AwaitingPayment or OrderStatuses.PaymentSubmitted` — so an admin
  cannot cancel a `pending` order; the choice is stated explicitly. Student
  owner / vendor owner authorization on that branch is unchanged.

- **Finding 4 [NIT] — endpoint-side screenshot-path validation not pinned once,
  authoritatively.** ADDRESSED in §4.4: a single authoritative statement in the
  `SubmitPaymentAsync` bullet now says the endpoint (not the pure service)
  rejects with `422 VALIDATION field=screenshotPath` unless `ScreenshotPath`
  equals `{id}/{rest}` with non-empty `rest` and `id` the route GUID; the
  reference-string rules stay in the pure `ValidateSubmitPayment`. §4.6's
  `screenshotPath` entry now defers to that one rule, removing the two-phrasing
  drift.

### Part 8b — Review responses (Revision 3, historical)

This review reviewed Revision 2 and returned CHANGES_REQUESTED with 0 HIGH, 4
MEDIUM (Findings 1–4),
2 NIT (Findings 5–6). Every finding is **addressed** below; none is backlogged
or ignored, and each fix was checked against the original authoritative request
(admin approval + management; vendor revenue PDF; GCash-gated manual pre-order)
and the requirements in Part 1 so none contradicts them. The review's Verified
Assumptions (all 27) and the code checks behind these findings were
re-confirmed against the worktree during this revision.

- **Finding 1 [MEDIUM] — no UI entry point for the legal vendor/admin cancel of
  a pre-payment order (FR3.5 "or cancel it").** ADDRESSED. Chose option (a):
  keep the requirement and the legal transitions, and add the missing UI. §4.5
  Dashboard Payments panel now specifies a **Cancel order** button (prompted
  required reason → `transitionOrder(uuid, { to: 'cancelled', reason })`) on
  `payment_submitted` rows and on the muted `awaiting_payment` group; §4.5 Admin
  Orders panel adds the same Cancel control on `payment_submitted` and
  `awaiting_payment` rows. Both are authorized server-side via the
  `StudentCancel` branch (student owner / vendor owner / admin) already specified
  in §4.4. New acceptance criterion 18. Requirement FR3.5, the §4.2/§4.3 legal
  pairs, and the UI now agree.

- **Finding 2 [MEDIUM] — `awaiting_payment → cancelled` student path not wired;
  the existing cancel button renders only on the `pending` step.** ADDRESSED in
  §4.5 `OrderStatus.jsx`: the `awaiting_payment` branch now renders its own
  "Cancel order" control (and the `payment_submitted` branch's cancel is made
  explicit), both calling the existing `cancelOrder` reason-prompt handler →
  `transitionOrder(order.uuid, { to: 'cancelled', reason })`. The note that the
  `isPending`-only button is unchanged (it keeps serving the `pending` step) is
  added so the existing behavior is preserved. FR3.8 is now fully wired for both
  pre-payment states. New acceptance criterion 17.

- **Finding 3 [MEDIUM] — revenue PDF per-day grouping/timezone under-specified;
  `placedAt`/`daysAgo` are not uniformly present.** ADDRESSED in §3.3 (and the
  §4.5 `loadOrders` bullet + §3.4 handler). A single canonical `placedAt` (epoch
  ms) is now added to the **done** bucket as well as the already-present **live**
  bucket, so every completed row in `allHistory` carries it; the PDF's per-day
  key is derived from that one field via
  `new Date(placedAt).toLocaleDateString('en-PH')`, and the day-boundary basis
  (the device's local time) is printed in the PDF header. `daysAgo` is retained
  only for the existing on-screen grouping and the range filter. New acceptance
  criterion 20.

- **Finding 4 [MEDIUM] — student GCash display has no empty/loading state, and
  the payment page's dependency on the full-list `getVendor` is not pinned.**
  ADDRESSED on both points. §4.5 `OrderStatus.jsx` `awaiting_payment` branch now
  specifies an explicit payment-details-unavailable state (when `vendor` is
  undefined or `vendor.gcashNumber` is falsy: show a "contact the vendor"
  message, render no form and no blank destination fields). §2.5 adds a pinned
  invariant that `getVendor` MUST stay bound to the full `vendors` list (never
  `publicVendors`), with the one-line reason that a store suspended mid-flow must
  still resolve for an order already placed. New acceptance criterion 19.

- **Finding 5 [NIT] — the `0009→0010` commit boundary is asserted, not enforced
  by operator procedure.** ADDRESSED in Part 5 (`supabase/README.md` note): the
  README must state "Run `0009_order_payment_enum.sql` as its own SQL-editor
  execution and let it finish before pasting/running `0010` — do not paste both
  into one run," because the SQL editor wraps a multi-statement paste in one
  transaction. The file split plus this operator step together guarantee the
  enum labels are committed before first use.

- **Finding 6 [NIT] — storage INSERT policy bounds who, not how many, objects;
  the filename segment is unconstrained.** ADDRESSED in §4.3 step 3 as a stated
  known limitation (parallel to the menu/review-RLS note in §2.3 step 4): the
  policy caps *who* writes under an order prefix but not *how many* objects; the
  unconstrained `<filename>` segment was considered; abuse is bounded to the
  student's own order prefixes and never surfaced (only the one path stored on
  the order row is ever signed). No per-prefix cap is added; accepted for scope.

### Part 8c — Review responses (Revision 2, historical)

The prior review returned
CHANGES_REQUESTED with 3 HIGH, 4 MEDIUM, 3 NIT. Every finding was **addressed**
below; none was backlogged or ignored, and each response was checked against the
original requirements so no fix contradicts them. The reviewer's Verified
Assumptions are unchanged by these edits (they still hold). These responses
remain in force in Revision 3.

- **Finding 1 [HIGH] — `transition_order` overload + lost grants.** ADDRESSED in
  §4.3 step 5. The 4-arg `(uuid, text, text, uuid)` overload is now explicitly
  created with `p_actor` **last**, the stale 3-arg function is `drop function if
  exists`-ed, and the new signature is `revoke`-d from `public`/`anon`/
  `authenticated` with the same guarded `do $$` block `0007` uses. Parameter
  order is pinned in the design so the SQL and the C# `TransitionRpcBody` agree.

- **Finding 2 [HIGH] — `ApplyTransitionAsync` arity ripple.** ADDRESSED in §4.4
  (`Data/Db.cs` bullet). The final signature `(orderService, orderId, to,
  reason, actor, ct)` is specified, the endpoint call site passes `userId.Value`,
  and all **six** named existing `DbSupabaseTests` are listed for the new
  argument, plus a new assertion pinning `p_actor` in the serialized body.
  Acceptance criterion 16 covers the compile.

- **Finding 3 [HIGH] — admin Orders panel has no UUID.** ADDRESSED in §4.5
  (`Admin.jsx`). The admin orders SELECT is extended to include `id`,
  `gcash_reference`, and `payment_screenshot_path`; rows are re-keyed by `o.id`;
  Verify/Reject call `transitionOrder(o.id, …)`; and admin "View screenshot"
  uses a signed URL. Kept in scope (FR3.4 permits admin) rather than dropped,
  and acceptance criterion 15 was added.

- **Finding 4 [MEDIUM] — GCash number conflated with contact `phone`.**
  ADDRESSED by a product decision in §2.2: add dedicated nullable
  `vendors.gcash_number` and `vendors.gcash_name` columns (migration `0008`),
  map them in `VendorContext.mapVendor`/`updateVendorInfo` (§2.5), surface them
  in the Dashboard store-info editor, gate pre-order enablement on
  `gcash_number` being set (§2.5 Dashboard gate), and show them (not `phone`) on
  the student payment step (§4.5). Chosen over "document phone = GCash" because
  silently routing real money to a contact field is a correctness/trust defect.
  Acceptance criterion 14 added.

- **Finding 5 [MEDIUM] — `ValidateTransition` three-bucket rule under-specified.**
  ADDRESSED in §4.4 with the exact C# predicate: `reasonRequired = to is
  Cancelled or AwaitingPayment`; required-if-missing, forbidden-otherwise,
  length-bounded. Verify (`→ pending`) is in the forbidden bucket, matching the
  no-reason UI call.

- **Finding 6 [MEDIUM] — sync test rename + exact 9-pair set + illegal-sample
  audit.** ADDRESSED in §4.4 tests: the method is renamed to
  `LegalTransitionSet_matches_sql_whitelist`, its comment cites `0010`, the exact
  9-pair whitelist is enumerated, the illegal samples are chosen to stay
  all-illegal, and an explicit instruction audits `OrderServiceTransitionTests`
  illegal cases for any now-legal pair (confirmed none present today).

- **Finding 7 [MEDIUM] — enum `ADD VALUE` + same-migration use is fragile.**
  ADDRESSED by splitting into `0009_order_payment_enum.sql` (two bare
  `ADD VALUE` statements only) and `0010_order_payment.sql` (everything that
  uses the labels). Apply order `0009 → 0010` with a commit between is documented
  in §4.2, §4.3, §2.3 (ordering invariant), Part 5, Part 6, Part 7.

- **Finding 8 [NIT] — test-file placement drift.** ADDRESSED in §4.4: transition
  reason-rule tests go in the existing `OrderServiceValidationTests.cs`;
  submit-payment body-rule tests go in the new `OrderServicePaymentTests.cs`.
  The split is stated so no duplicate assertions are created.

- **Finding 9 [NIT] — `setPreorder` vs `setPreorderEnabled` naming.** ADDRESSED
  in §2.5 Dashboard gate: the local wrapper `setPreorder` →
  `setPreorderEnabled(vid, on)` is named precisely, and the gate is placed at the
  Switch (plus the independent `publicVendors` exclusion on the student side).

- **Finding 10 [NIT] — screenshot orphan / upload ordering.** ADDRESSED in §4.7:
  upload-then-submit is now a documented deliberate choice with rationale (the
  Storage INSERT policy authorizes the upload before the status flip), and the
  bounded, never-surfaced orphan is accepted for scope.

Review notes on unverified external dependencies (Storage schema presence) are
folded into §4.3 step 3 and the supabase verification checklist (Part 5).
