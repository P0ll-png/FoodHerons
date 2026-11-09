# Implementation Plan — Admin approval, Vendor revenue PDF, GCash-gated pre-orders

This plan implements the SETTLED design in `.agents/tasks/new-features/design.md`
(Revision 4). All work happens under the worktree
`c:\Users\paulc\Projects\FoodHerons\.worktrees\new-features` on branch
`feature/admin-revenue-gcash`. Use absolute paths; use
`git -C c:\Users\paulc\Projects\FoodHerons\.worktrees\new-features` for git.

## Orientation (grounded in the worktree)

- Baseline is green: `dotnet build server/FoodHerons.sln` and
  `dotnet test server/FoodHerons.sln` pass (78 tests, SDK net10.0). `node_modules`
  is absent, so `npm install` must run before `npm run build`.
- Migrations are numbered `0001`–`0007`; enums live in `0002_enums.sql` guarded by
  `do $$ ... if not exists (select 1 from pg_type ...)`. The vendors column guard
  `guard_vendor_columns()` and the signup trigger `handle_new_user()` live in
  `0004`; the `vendors_select_all` policy (`using (true)`) lives in `0005`;
  `place_order` + `transition_order` (3-arg) with their guarded REVOKEs live in `0007`.
- API: pure logic in `Services/OrderService.cs` + `Services/OrderDomain.cs`; the
  Supabase HTTPS data layer in `Data/Db.cs` (RPC bodies as records with
  `[JsonPropertyName("p_*")]`); endpoints in `Endpoints/OrdersEndpoints.cs`; DTOs in
  `Dtos/OrderDtos.cs`. `ApplyTransitionAsync` is currently 5-arg
  `(orderService, orderId, to, reason, ct)` and `TransitionRpcBody` is 3-field.
  Tests: `DbSupabaseTests.cs` (incl. `LegalTransitionSet_matches_0007_sql_whitelist`
  and six `ApplyTransitionAsync_*` tests that call the 5-arg shape),
  `OrderServiceTransitionTests.cs`, `OrderServiceValidationTests.cs`.
- Frontend: `VendorContext.jsx` reads `vendors` with `select('*')`, maps snake→camel
  in `mapVendor`, patch-builds in `updateVendorInfo`, and already exposes
  `setPreorderEnabled`, `getVendor`. `Home.jsx`/`Search.jsx` consume `vendors`;
  `VendorStore.jsx` computes `canOrder = preorderEnabled && isOpen`. `Admin.jsx` has
  `VendorsPanel`/`VendorRow` (with the `run()` write helper), `ReviewsPanel`, and a
  read-only `OrdersPanel` (orders SELECT has no `id`; rows keyed by `o.code`).
  `Dashboard.jsx` wires `setPreorder = (on) => setPreorderEnabled(vid, on)`, buckets
  orders in `loadOrders` into `live`/`done` (only `live.push` sets `placedAt`),
  `allHistory` memo, `DashboardTab` with `RANGES`/`inRange`, `OrdersTab` filtered by
  `STATUS_ORDER`, and `ProfileTab` (store-info editor, `FORM_KEYS`, the `phone`
  field). `Cart.jsx` posts then navigates to `/order/:id`. `OrderStatus.jsx` has
  `STATE_UI`/`STEPS`/`DB_STATUS_TO_STEP`, a `cancelOrder` reason-prompt handler, and
  an `isPending`-only cancel button. `src/lib/api.js` exports `postOrder`,
  `transitionOrder`.

## Conventions every item follows

- DB: new changes ONLY in NEW numbered migrations `0008`/`0009`/`0010`; never edit
  `0001`–`0007`. Match the `do $$` enum idempotency and the guarded REVOKE patterns.
- API: snake_case DB ↔ camelCase UI; `DomainError` + `ErrorCodes`; RPC bodies as
  records with `[JsonPropertyName("p_*")]`; `ct` stays the last parameter.
- Frontend: reuse existing components/tokens/`Icon`; palette oranges/yellows/white,
  NO blue; dark mode; mobile-first; accessible (`role="alert"`, labelled controls).
  No new UI framework, no restyle. Browser never writes `orders`/`order_items`.
- Verification uses the project's real commands: `dotnet build server/FoodHerons.sln`,
  `dotnet test server/FoodHerons.sln`, and (after `npm install`) `npm run build`.

---

## FEATURE 1 — Admin store approval + app management

- [ ] 1. Create migration `0008_vendor_approval.sql` (approval enum + columns + guard + RLS).
      Add `public.vendor_approval_status` enum (`pending/approved/rejected/suspended`) in a
      `do $$ ... if not exists (select 1 from pg_type ...)` block mirroring `0002`. Add
      `vendors.approval_status` NOT NULL DEFAULT `'pending'`, backfill existing rows to
      `'approved'` (`update ... where approval_status = 'pending'`), add
      `vendors_approval_status_idx`, and add nullable `vendors.gcash_number` / `gcash_name`.
      `create or replace function public.guard_vendor_columns()` re-declaring the WHOLE `0004`
      body plus a new branch: reject `approval_status` change when `public.auth_role() <> 'admin'`
      (keep the service-role early return, the rating_sync flag, rating/review_count, and owner_id
      guards intact). Drop `vendors_select_all`; create `vendors_select_approved_or_privileged`
      (`approval_status = 'approved' or owner_id = auth.uid() or public.auth_role() = 'admin'`).
      Files: supabase/migrations/0008_vendor_approval.sql
      Verify: SQL-file review against `0002`/`0004`/`0005` patterns (no automated DB harness
      exists — DB is verified manually per `supabase/README.md` / `PHASE-A-VERIFICATION.md`).
      The frontend `npm run build` in later items is the compile-time gate for the app code that
      consumes these columns.

- [ ] 2. Map the new columns and derive `publicVendors` in `VendorContext.jsx`.
      In `mapVendor` add `approvalStatus: r.approval_status`, `gcashNumber: r.gcash_number`,
      `gcashName: r.gcash_name`. In `updateVendorInfo` extend the patch builder with
      `gcash_number`/`gcash_name` (mirror the `phone` lines). Add a derived
      `publicVendors = vendors.filter(v => v.approvalStatus === 'approved')` to the memo and the
      context value; keep `getVendor` and `currentVendorId` bound to the FULL `vendors` list
      (pinned invariant §2.5 — the payment step resolves `getVendor` for suspended-mid-flow stores).
      Files: src/context/VendorContext.jsx
      Verify: `npm install` (first run only) then `npm run build` succeeds.

- [ ] 3. Switch student-facing surfaces to `publicVendors`.
      `Home.jsx`: swap `vendors` → `publicVendors` in `VendorResults` list props,
      `categoryVendors`, `openCount`, and the hero stats count. `Search.jsx`: swap `vendors` →
      `publicVendors` in `results` and `popular`. `VendorStore.jsx`: keep `getVendor(id)` (full
      list) but when the resolved store's `approvalStatus !== 'approved'`, force `canOrder = false`
      and show the existing `store-note` message ("This vendor isn't available right now.").
      Files: src/pages/Home.jsx, src/pages/Search.jsx, src/pages/VendorStore.jsx
      Verify: `npm run build` succeeds; a direct link to a non-approved store is not orderable.

- [ ] 4. Extend `Admin.jsx` Vendors panel with approval workflow (no parallel page).
      Add an approval status filter row (chips All/Pending/Approved/Rejected/Suspended reusing
      `.chip`/`.admin-tab`). In `VendorRow` add a status badge (pending→`badge--preorder`,
      approved→`badge--open`, rejected/suspended→`badge--closed`) and status-dependent buttons
      calling the existing `run(() => supabase.from('vendors').update({ approval_status: '<next>' })
      .eq('id', vendor.id))`: pending→Approve/Reject, approved→Suspend, rejected/suspended→
      Re-activate(approved). Optionally show a pending count badge on the Vendors tab. Add matching
      status styles in `Admin.css` using existing orange/yellow tokens (no blue).
      Files: src/pages/Admin.jsx, src/pages/Admin.css
      Verify: `npm run build` succeeds.

- [ ] 5. Gate the Dashboard pre-order Switch and add GCash fields to the store editor.
      In `Dashboard.jsx`: when `vendor.approvalStatus !== 'approved'` render a `dashboard-empty`
      banner (awaiting approval / suspended) and disable the pre-order Switch so `setPreorder(true)`
      cannot fire; when `!vendor.gcashNumber` disable the Switch with the hint "Add your GCash number
      in Store info to enable pre-ordering" (pass disabled/hint state through `TopBar` to the
      `Switch`). In `ProfileTab` add `gcashNumber`/`gcashName` inputs next to `phone` (reuse
      `dashboard-field`/`dashboard-input`), add their keys to `FORM_KEYS`, and include them in the
      `profile` memo so they persist via `updateVendorInfo`.
      Files: src/pages/Dashboard.jsx
      Verify: `npm run build` succeeds; Switch is disabled with the hint until a GCash number is set
      and while not approved.

---

## FEATURE 2 — Vendor revenue PDF export

- [ ] 6. Pin the PDF dependencies.
      Add to `dependencies` in `package.json`, exact versions (no caret): `"jspdf": "2.5.2"`,
      `"jspdf-autotable": "3.8.4"`.
      Files: package.json
      Verify: `npm install` resolves both at the pinned versions (`npm ls jspdf jspdf-autotable`).

- [ ] 7. Add the canonical `placedAt` to the Dashboard `done` bucket.
      In `loadOrders` (`Dashboard.jsx`), add `placedAt: Date.parse(o.placed_at)` to the `done.push`
      mapping (the `live.push` already has it); keep `daysAgo` on the done rows for the existing
      history grouping and range filter. This makes every completed row in `allHistory` carry a
      canonical `placedAt` for the PDF.
      Files: src/pages/Dashboard.jsx
      Verify: `npm run build` succeeds.

- [ ] 8. Create `src/lib/revenuePdf.js` (pure, DOM-free).
      Export `aggregateByDay(orders)` keyed by `new Date(placedAt).toLocaleDateString('en-PH')`
      (named export, unit-testable later) and `buildRevenuePdf({ storeName, rangeLabel, generatedAt,
      days, grandTotal, orderCount })` returning a jsPDF doc: header (store name, "Revenue report",
      range label, generatedAt, and a "Day boundary: your device's local time" line), an autoTable
      with columns [Date, Completed orders, Revenue (PHP)], and a summary row for `orderCount` +
      `grandTotal`. Print amounts as `PHP 1,234.00` via `toLocaleString('en-PH')` (no ₱ glyph).
      Handle the empty range with a single "No completed orders in this range" line and zero total.
      Files: src/lib/revenuePdf.js
      Verify: `npm run build` succeeds (module imports/resolves).

- [ ] 9. Wire the "Export PDF" button in `DashboardTab`.
      Add an "Export PDF" button in the `DashboardTab` toolbar styled `dashboard-btn
      dashboard-btn--outline` with the `download` icon. Handler: take the in-range completed orders,
      build `days` via `aggregateByDay` keyed by each order's `placedAt`, call `buildRevenuePdf(...)`,
      `doc.save('revenue-' + range + '.pdf')`, and `flash('Revenue report downloaded')`. Wrap in
      try/catch → `flash('Could not generate the PDF. Please try again.')` + `console.error`. Leave
      the existing CSV `exportReport` untouched.
      Files: src/pages/Dashboard.jsx
      Verify: `npm run build` succeeds; manual click produces a PDF whose grand total equals the sum
      of in-range completed order totals.

---

## FEATURE 3 — GCash-gated pre-orders

### DB (order split is load-bearing)

- [ ] 10. Create `0009_order_payment_enum.sql` — enum `ADD VALUE` only.
      Exactly two bare, autocommitted statements:
      `alter type public.order_status add value if not exists 'awaiting_payment';` and
      `... 'payment_submitted';`. No other statements (they cannot run inside an explicit
      begin/commit, and must be committed before `0010` uses the labels).
      Files: supabase/migrations/0009_order_payment_enum.sql
      Verify: SQL-file review; the `OrderStatuses`/whitelist tests in item 15/16 pin the labels in C#.

- [ ] 11. Create `0010_order_payment.sql` — columns, default, storage, RPCs, overload + grants.
      (a) `alter table public.orders add column if not exists`: `payment_method text not null default
      'gcash'`, `gcash_reference text`, `payment_screenshot_path text`, `payment_verified_at
      timestamptz`, `payment_verified_by uuid references public.profiles(id)`, `payment_rejected_reason
      text`, `payment_submitted_at timestamptz`; then `alter column status set default
      'awaiting_payment'`. (b) `insert into storage.buckets ('payment-proofs', ..., false) on conflict
      do nothing`; the `payment_proofs_insert_owner` INSERT policy and the `payment_proofs_select_visible`
      SELECT policy (both keyed off `(split_part(name,'/',1))::uuid`; SELECT authorizes student owner OR
      vendor owner via `v.id = o.vendor_id and v.owner_id = auth.uid()` OR `public.auth_role() = 'admin'`)
      — copy the exact SQL from design §4.3 step 3; no UPDATE/DELETE policies. (c) `create or replace
      function public.submit_payment(p_id uuid, p_reference text, p_screenshot_path text) returns
      public.orders` (SECURITY DEFINER, `for update` lock, raise `FH002` if not found, raise `FH001` if
      status <> 'awaiting_payment', set reference/screenshot/`payment_submitted_at = now()`/status =
      'payment_submitted'). (d) `create or replace function public.transition_order(p_id uuid, p_to text,
      p_reason text, p_actor uuid)` — p_actor LAST — adding the 4 new whitelist pairs
      (`payment_submitted→pending`, `payment_submitted→awaiting_payment`, `awaiting_payment→cancelled`,
      `payment_submitted→cancelled`) and setting `payment_verified_at/by` on `→pending`,
      `payment_rejected_reason` on `→awaiting_payment`, keeping existing CASE lines. (e) `drop function if
      exists public.transition_order(uuid, text, text);` then guarded REVOKEs on the 4-arg signature and on
      `public.submit_payment(uuid, text, text)` (same `do $$` shape as `0007`).
      Files: supabase/migrations/0010_order_payment.sql
      Verify: SQL-file review against `0007` patterns; the C# sync test in item 16 asserts the SQL
      whitelist matches `OrderService.Legal` (9 pairs).

### API — pure domain/service (do before Db/endpoints so types exist)

- [ ] 12. Extend `OrderDomain.cs`.
      In `OrderStatuses` add `AwaitingPayment = "awaiting_payment"` and `PaymentSubmitted =
      "payment_submitted"` and include both in `All`. Add `TransitionKind.PaymentReview`.
      Files: server/FoodHerons.Api/Services/OrderDomain.cs
      Verify: `dotnet build server/FoodHerons.sln` compiles.

- [ ] 13. Extend `OrderService.cs` — Legal set, classification, validation, submit-payment rules.
      Add the 4 new pairs to `Legal`. In `PlanTransition`, classify `payment_submitted→pending` and
      `payment_submitted→awaiting_payment` as `PaymentReview`, and `awaiting_payment→cancelled` /
      `payment_submitted→cancelled` as `StudentCancel`. Rewrite `ValidateTransition` to the exact
      three-bucket predicate (design §4.4): `reasonRequired = To is Cancelled or AwaitingPayment`;
      required-if-missing, forbidden-otherwise, length-bounded by `ReasonMax`. Add pure
      `ValidateSubmitPayment(SubmitPaymentRequest)`: `gcashReference` required, trimmed length 4–40
      (`GcashRefMin=4`/`GcashRefMax=40`), chars digits/space/hyphen → 422 VALIDATION field
      `gcashReference`; `screenshotPath` is NOT checked here.
      Files: server/FoodHerons.Api/Services/OrderService.cs
      Verify: `dotnet build server/FoodHerons.sln` compiles.

- [ ] 14. Extend `OrderDtos.cs`.
      Add `SubmitPaymentRequest(string? GcashReference, string? ScreenshotPath)`. Add read-only
      projections to `OrderDto`: `GcashReference`, `PaymentSubmittedAt`, `PaymentVerifiedAt`,
      `PaymentRejectedReason`, `PaymentScreenshotPath`.
      Files: server/FoodHerons.Api/Dtos/OrderDtos.cs
      Verify: `dotnet build server/FoodHerons.sln` compiles (callers updated in items 15/17).

### API — data layer + endpoints

- [ ] 15. Extend `Data/Db.cs` — SubmitPaymentAsync, 4-arg transition arity, payment columns.
      Add `SubmitPaymentAsync(Guid id, string reference, string? screenshotPath, CancellationToken)`
      posting to `rpc/submit_payment` with the same FH001→ILLEGAL_TRANSITION / FH002→NOT_FOUND mapping.
      Add `[property: JsonPropertyName("p_actor")] Guid Actor` to `TransitionRpcBody` and change
      `ApplyTransitionAsync` to `(OrderService, Guid orderId, string to, string? reason, Guid actor,
      CancellationToken ct)` — actor AFTER reason, before ct — building `new TransitionRpcBody(orderId,
      to, reason, actor)`. Extend `OrderRow`/`OrderRowDto`/`OrderState`/`OrderStateDto` and `ToOrderRow`
      with the new payment columns so responses/state carry them. This is a breaking change; update the
      endpoint call site (item 17) and the six tests (item 18) in the same feature so the solution
      compiles.
      Files: server/FoodHerons.Api/Data/Db.cs
      Verify: `dotnet build server/FoodHerons.sln` compiles after items 17–18 land.

- [ ] 16. Update the DB sync test to the 9-pair whitelist and rename it.
      In `DbSupabaseTests.cs` rename `LegalTransitionSet_matches_0007_sql_whitelist` →
      `LegalTransitionSet_matches_sql_whitelist`, update its comment to cite `0010_order_payment.sql`,
      set `sqlWhitelist` to the exact 9 pairs (design §4.4), and make `illegalSamples` all-illegal
      (`awaiting_payment→preparing`, `payment_submitted→ready`, `awaiting_payment→completed`; no
      now-legal pair). Keep it asserting the SQL set equals `OrderService.Legal`.
      Files: server/FoodHerons.Api.Tests/DbSupabaseTests.cs
      Verify: `dotnet test server/FoodHerons.sln` — this test passes.

- [ ] 17. Add the payment endpoint + extend transition authorization in `OrdersEndpoints.cs`.
      Map `POST /orders/{id:guid}/payment` → `SubmitPaymentAsync`: require auth; require role `student`;
      load state; require `state.StudentId == userId`; run pure `ValidateSubmitPayment`; then the
      AUTHORITATIVE screenshot-path check — when `request.ScreenshotPath` is non-null reject 422
      VALIDATION field `screenshotPath` unless it equals `$"{id}/{rest}"` with non-empty `rest`; call
      `db.SubmitPaymentAsync`; return `OrderDto`. In `TransitionAsync`: authorize `PaymentReview` for
      vendor owner OR admin (`http.User.GetRole() == "admin"`); in the `StudentCancel` branch add the
      admin allowance ONLY when `plan.From is AwaitingPayment or PaymentSubmitted` (not plain pending);
      pass `userId.Value` as the new `actor` arg to `ApplyTransitionAsync`. Extend `ToOrderDto` for the
      new fields.
      Files: server/FoodHerons.Api/Endpoints/OrdersEndpoints.cs
      Verify: `dotnet build server/FoodHerons.sln` compiles.

### API — tests

- [ ] 18. Update the six `ApplyTransitionAsync` tests and add payment/transition tests.
      In `DbSupabaseTests.cs` add the `actor` arg (e.g. `Guid.NewGuid()`) to the six existing
      `ApplyTransitionAsync_*` tests, add an assertion in `ApplyTransitionAsync_success_returns_ok` that
      the serialized body carries `p_actor` equal to the passed actor, and add `SubmitPaymentAsync`
      success + FH001/FH002 mapping cases (stub-handler style). In `OrderServiceTransitionTests.cs` add
      the 4 new legal pairs to `Legal_transitions_allowed`, add illegal rows (`awaiting_payment→preparing`,
      `payment_submitted→ready`, `awaiting_payment→completed`), audit `Illegal_transitions_rejected` to
      confirm none of the 4 new legal pairs appears, and add classification tests (PaymentReview /
      StudentCancel). In `OrderServiceValidationTests.cs` add reason-rule tests (required for
      `→cancelled` and `→awaiting_payment`; forbidden for `→pending` verify and forward moves;
      over-length rejected). Create `OrderServicePaymentTests.cs` for `ValidateSubmitPayment`
      (required/empty/too-long reference, screenshot optional, valid case).
      Files: server/FoodHerons.Api.Tests/DbSupabaseTests.cs,
      server/FoodHerons.Api.Tests/OrderServiceTransitionTests.cs,
      server/FoodHerons.Api.Tests/OrderServiceValidationTests.cs,
      server/FoodHerons.Api.Tests/OrderServicePaymentTests.cs
      Verify: `dotnet test server/FoodHerons.sln` — all tests pass (78 existing + new).

### Frontend — flow

- [ ] 19. Add `submitPayment` to `src/lib/api.js`.
      Add `submitPayment(id, { gcashReference, screenshotPath })` → `POST /orders/{id}/payment`
      (reuse the `request` helper). `postOrder`/`transitionOrder` unchanged.
      Files: src/lib/api.js
      Verify: `npm run build` succeeds.

- [ ] 20. Update `Cart.jsx` checkout copy for the GCash step.
      Replace the "Pay cash upon pickup" block/copy and the `.checkout__fine` note to say GCash payment
      is required next; keep navigating to `/order/:id` on success (the order page now hosts the payment
      step for an `awaiting_payment` order). No new route.
      Files: src/pages/Cart.jsx
      Verify: `npm run build` succeeds.

- [ ] 21. Add the payment step + both pre-payment cancels to `OrderStatus.jsx`.
      Extend `fetchOrder`'s select with `gcash_reference, payment_submitted_at, payment_rejected_reason`
      (status already selected). Add `awaiting_payment`/`payment_submitted` entries to `STATE_UI` and a
      leading "Payment" tracker step; map both in `DB_STATUS_TO_STEP`. `awaiting_payment`: resolve
      `getVendor(order.vendorId)` (FULL list); if vendor undefined OR `!vendor.gcashNumber`, render the
      payment-details-unavailable message (reuse `order-review__error`/`store-note`) with no form/blank
      fields; otherwise show `vendor.gcashName`/`vendor.gcashNumber` (NOT `phone`), a "send exactly
      ₱{total}" instruction, a required reference input and optional screenshot file input. On submit:
      if a screenshot is chosen, `supabase.storage.from('payment-proofs').upload(`${order.uuid}/${filename}`,
      file)` first (fall back to reference-only on upload error), then `submitPayment(order.uuid, {
      gcashReference, screenshotPath })` and refresh. Render a "Cancel order" control on BOTH
      `awaiting_payment` and `payment_submitted` branches reusing the existing `cancelOrder` reason-prompt
      handler → `transitionOrder(order.uuid, { to: 'cancelled', reason })`; show
      `payment_rejected_reason` on a rejected-back `awaiting_payment`. Leave the `isPending`-only cancel
      button unchanged. Add status styles in `OrderStatus.css` (orange/yellow, no blue).
      Files: src/pages/OrderStatus.jsx, src/pages/OrderStatus.css
      Verify: `npm run build` succeeds.

### Frontend — vendor + admin verification surfaces

- [ ] 22. Add the Dashboard Payments surface + per-day `placedAt` was already added in item 7.
      In `Dashboard.jsx` extend `loadOrders`' select with `gcash_reference, payment_screenshot_path`
      and add a `payments` bucket for `payment_submitted` orders (and a muted `awaiting_payment` group);
      add a "Payments" tab/section listing pickup name, total, GCash reference, a "View screenshot" link
      (signed URL via `supabase.storage.from('payment-proofs').createSignedUrl(path, 60)`, null-path →
      "No screenshot provided"), and buttons: Verify → `transitionOrder(uuid, { to: 'pending' })`; Reject
      → prompt reason → `transitionOrder(uuid, { to: 'awaiting_payment', reason })`; Cancel order →
      prompt required reason → `transitionOrder(uuid, { to: 'cancelled', reason })`; each then
      `loadOrders`. `awaiting_payment` rows get Cancel only (no Verify/Reject). These stay out of the
      Incoming queue because `OrdersTab` filters by `STATUS_ORDER`. Add status styles in `Dashboard.css`
      (orange/yellow, no blue).
      Files: src/pages/Dashboard.jsx, src/pages/Dashboard.css
      Verify: `npm run build` succeeds.

- [ ] 23. Build the admin `OrdersPanel` write path in `Admin.jsx`.
      Extend the admin orders SELECT in `loadAll` to `id, code, vendor_id, status, pickup_name, subtotal,
      total, placed_at, gcash_reference, payment_screenshot_path` and key `OrdersPanel` rows by `o.id`
      (display `o.code`). Pass `onChanged={loadAll}` and `setError` to `OrdersPanel`; inside it
      `import { transitionOrder } from '../lib/api'` and implement its own per-row busy/disabled state,
      reason prompts, and error surfacing via `setError`, refreshing with `onChanged()`. For
      `payment_submitted` rows: Verify → `transitionOrder(o.id, { to: 'pending' })`; Reject → prompt
      reason → `{ to: 'awaiting_payment', reason }`; Cancel → prompt required reason → `{ to:
      'cancelled', reason }`. For `awaiting_payment` rows: Cancel only. "View screenshot" via signed URL
      (null-path → "No screenshot provided"). Non-pre-payment rows stay read-only. Note: these admin
      order writes go through the C# order service, unlike every other admin write in the file. Add
      status styles in `Admin.css` (orange/yellow, no blue).
      Files: src/pages/Admin.jsx, src/pages/Admin.css
      Verify: `npm run build` succeeds.

---

## CROSS-CUTTING — docs + final verification

- [ ] 24. Update `supabase/README.md` and root `README.md`.
      `supabase/README.md`: add apply steps in order `0008 → 0009 → 0010`, stating explicitly that
      `0009_order_payment_enum.sql` must run as its OWN SQL-editor execution and finish before `0010`
      (the editor wraps a multi-statement paste in one transaction); note the `payment-proofs` private
      bucket, the hosted `storage` schema prerequisite, the one-time auto-approve backfill, and that
      vendors must set a GCash number before pre-ordering works. Root `README.md`: remove "no approval
      step" (vendor stores need admin approval), mention pre-order GCash verification + client-side
      revenue PDF on `/dashboard`, add a `/admin` row.
      Files: supabase/README.md, README.md
      Verify: docs review — both files reflect the three new behaviors and the migration order.

- [ ] 25. Full build + test gate.
      Run `dotnet build server/FoodHerons.sln`, `dotnet test server/FoodHerons.sln`, and `npm run build`
      (after `npm install`). Fix any failures before completion. Clean up any temporary files.
      Files: (none — verification only)
      Verify: all three commands succeed; the .NET test count is the prior 78 plus the new payment/
      transition/validation tests, all green.

---

## Implementation order (summary)

Feature 1 (items 1–5) → Feature 2 (items 6–9) → Feature 3 DB+API+tests+frontend (items 10–23) →
cross-cutting docs + full gate (items 24–25). Within Feature 3 the DB migration split (0009 before
0010) and the API arity change (Db.cs + endpoint call site + the six tests together) are the
load-bearing ordering constraints: land the breaking `ApplyTransitionAsync` signature and its callers
in one buildable step. Each item leaves the codebase buildable.
