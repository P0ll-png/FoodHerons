# Design review — Admin approval, vendor revenue PDF, GCash-gated pre-orders

Reviewer: design-review subagent (fresh read, no authoring context).
Design under review: `.agents/tasks/new-features/design.md` (Revision 3).
Worktree checked: `c:\Users\paulc\Projects\FoodHerons\.worktrees\new-features`.

This is a mature revision that has already absorbed two prior review passes. I
read the design end to end and then verified every schema/endpoint/RLS/route/
component claim it relies on against the actual worktree source. The vast
majority of its assumptions are correct and are listed under Verified
Assumptions below. The findings that remain are a small number of concrete
gaps a first-time implementer could get wrong, centered on one security
boundary that is specified only in prose.

Verdict is mechanical: count HIGH + MEDIUM. See `design-verdict.json`.

---

## Findings

### 1. [MEDIUM] Storage `payment-proofs` SELECT policy is specified only in prose, not as SQL — a security boundary left to interpretation

Location: §4.3 step 3 (Database changes — `0010_order_payment.sql`, Storage
bucket + policies).

The INSERT policy for `storage.objects` is given verbatim and is correct. The
**SELECT** policy — which governs who can mint a signed URL for a payment
screenshot (the owning student, the vendor owner, an admin) — is described only
as "the analogous `exists` predicate joining `orders` (and `vendors` for the
owner branch) + `public.auth_role() = 'admin'`." No concrete SQL is given.

This is the access-control boundary for student-uploaded financial proof
images. Leaving it as prose invites an implementer to get the join wrong — for
example, joining `orders` by path segment but forgetting to also constrain the
vendor-owner branch to `vendors.owner_id = auth.uid()`, which would let *any*
authenticated vendor sign a URL for *any* order's screenshot. The rest of the
migration pins exact SQL for every other guard; this one deserves the same.

Concrete fix — add the explicit policy to §4.3 step 3, e.g.:

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

Pin it the same way the INSERT policy is pinned so the three authorized reader
classes (student owner / vendor owner / admin) are unambiguous.

### 2. [MEDIUM] Admin Orders panel payment controls have no existing write scaffolding; the design reuses a `run()` helper that lives in a different component

Location: §4.5 (`Admin.jsx` — admin verify/reject/cancel of `payment_submitted`
orders).

Verified against `src/pages/Admin.jsx`: the `run()` async-write helper (busy +
setError + re-fetch) lives inside **`VendorRow`** (the Vendors panel). The
**`OrdersPanel`** component is a pure read-only table — it does not import
`transitionOrder`, holds no busy/error state, and keys its rows by `o.code`.
The §2.5 approval buttons correctly reuse `VendorRow`'s `run()`, but the §4.5
admin payment actions sit in `OrdersPanel`, which has **none** of that
machinery. The design narrates the row/SELECT changes (add `id`, re-key by
`o.id`, add Verify/Reject/Cancel) but never states that `OrdersPanel` must grow
its own write path: a `transitionOrder` import, per-row busy/disabled state, a
reason prompt, error surfacing via the page-level `setError`, and a
`loadAll()` refresh on success.

Without this stated, an implementer following the "reuse the existing helper"
language will look for a `run()` in `OrdersPanel` and not find one.

Concrete fix — in §4.5, state that `OrdersPanel` must receive `onChanged`
(=`loadAll`) and `setError` props (like `VendorsPanel`/`ReviewsPanel` already
do), import `transitionOrder` from `../lib/api`, and implement its own
busy/reason/error handling for the Verify/Reject/Cancel actions (it cannot reuse
`VendorRow.run`, which is scoped to the Vendors panel and writes via
`supabase.from('vendors')`, not the order service). Note that the admin order
writes go through the **C# order service** (`transitionOrder`), not a direct
Supabase update — unlike every existing admin write in that file.

### 3. [NIT] Widening the `StudentCancel` auth branch to admins also grants admins cancel of a plain `pending` order — an unstated scope change

Location: §4.4 (`OrdersEndpoints.cs` — "StudentCancel already allows student
owner or vendor owner; add the admin allowance for the pre-payment cancels").

Verified: the existing `TransitionKind.StudentCancel` branch authorizes
`state.StudentId == userId || IsVendorOwner`, and it classifies both
`pending → cancelled` **and** the new `awaiting_payment/payment_submitted →
cancelled`. Adding `|| admin` to that single branch necessarily also lets an
admin cancel a `pending` order, which is not among the stated requirements
(FR3.5 is about pre-payment cancel; admin app-management scope in message 2 was
"approve stores and overall app management"). This is probably benign, but it is
an authorization widening the design does not call out.

Concrete fix — either (a) explicitly accept and document that admins may cancel
any `StudentCancel`-classified order (including `pending`), or (b) scope the
admin allowance to only the two pre-payment from-states, e.g. authorize admin in
the `StudentCancel` branch only when `plan.From is awaiting_payment or
payment_submitted`. Pick one and state it.

### 4. [NIT] Endpoint-side screenshot-path validation is split from the pure `ValidateSubmitPayment` but the exact endpoint check is not pinned

Location: §4.4 (`ValidateSubmitPayment`) and §4.6 (`screenshotPath` rule).

The design correctly notes that the `<uuid>/<name>` path's uuid-equals-route-id
check "needs the route id" and so lives in the endpoint, not the pure service.
But it pins the pure service's rules (required reference, 4–40, char class) far
more firmly than the endpoint-side path check, which is described twice in
slightly different words ("must be a `<uuid>/<name>` shape and its uuid must
equal the route order id" in §4.4; "must match `^<order-uuid>/.+`" in §4.6)
without a single authoritative statement of where it runs and what it returns.

Concrete fix — state once, authoritatively, that `SubmitPaymentAsync` (the
endpoint) performs: if `ScreenshotPath` is non-null, reject with
`422 VALIDATION field=screenshotPath` unless
`ScreenshotPath == $"{id}/{rest}"` with a non-empty `rest` and `id` the route
GUID; otherwise call `db.SubmitPaymentAsync`. Keep the reference-string rules in
the pure `ValidateSubmitPayment`. This removes the two-phrasing drift.

---

## Verified Assumptions

Every item below was checked against the worktree source and holds:

1. Migrations `0001`–`0007` exist; `0008`/`0009`/`0010` do not — new numbered
   files, no edits to applied ones, is feasible. (`supabase/migrations/`)
2. `order_status` enum has exactly `pending/preparing/ready/completed/cancelled`
   and no payment states yet. (`0002_enums.sql`)
3. `user_role` is a true enum incl. `admin`; design's "new enum for closed
   domain" precedent is real. (`0002_enums.sql`)
4. `vendors` has a `phone` contact column and **no** payment/approval columns;
   the "GCash ≠ phone" rationale is grounded. (`0003_tables.sql`)
5. `orders.status` defaults to `'pending'`; `place_order` omits status and
   relies on the column default — so flipping the default to
   `'awaiting_payment'` works as claimed. (`0003_tables.sql`, `0007`)
6. `handle_new_user`'s vendor INSERT lists only `(id, owner_id, name)`, so the
   new `approval_status` DEFAULT applies with no trigger change. (`0004`)
7. `guard_vendor_columns` exists in `0004` with the service-role early return,
   the rating/review_count guard, and the owner_id admin-only guard — the
   proposed `approval_status` admin-only guard matches that exact shape.
8. `vendors_select_all` is `using (true)`; replacing it with an approved-or-
   privileged policy is accurate, and anon `auth.uid()` is null so anon sees
   only approved. (`0005_rls.sql`)
9. `menu_items`/`reviews` keep `using (true)` SELECT; the "hidden store's menu
   rows still directly readable" known-limitation note is correct. (`0005`)
10. `vendors_update_owner_or_admin` exists, letting an owner UPDATE their row —
    so the column guard (not the policy) is where `approval_status` must be
    gated. (`0005`)
11. `transition_order` is the 3-arg `(uuid, text, text)` with a 5-pair
    whitelist and `FH001`/`FH002` error codes; `create or replace` would NOT
    drop the old overload and `0007`'s REVOKEs target the 3-arg signature only —
    the design's explicit `drop function` + 4-arg revoke is necessary and
    correct. (`0007`)
12. `place_order`'s guarded `do $$ … revoke … from anon, authenticated` pattern
    is exactly what the design mirrors for `submit_payment`. (`0007`)
13. C# `OrderStatuses` has the 5 values and `All`/`IsValid`; adding two values +
    `All` membership is a clean extension. (`Services/OrderDomain.cs`)
14. `TransitionKind` has exactly `VendorAction`/`StudentCancel`; adding
    `PaymentReview` is additive. (`OrderDomain.cs`)
15. `OrderService.Legal` has exactly the 5 pairs; `ValidateTransition` is the
    two-way `isCancel` branch the design rewrites; `ReasonMax = 140`;
    `PlanTransition` classifies `pending→cancelled` as `StudentCancel`.
    (`Services/OrderService.cs`)
16. `Db.ApplyTransitionAsync(OrderService, Guid, string, string?, CancellationToken)`
    is the current 5-arg shape; `TransitionRpcBody` has 3 `p_*` properties; the
    arity ripple to the endpoint + 6 tests is real. (`Data/Db.cs`)
17. Exactly **6** `ApplyTransitionAsync_*` tests exist in `DbSupabaseTests.cs`,
    named as the design lists them.
18. The sync test is named `LegalTransitionSet_matches_0007_sql_whitelist` and
    cites `0007` in its comment — the rename to `_matches_sql_whitelist` + cite
    `0010` is accurate. (`DbSupabaseTests.cs`)
19. `Illegal_transitions_rejected` contains exactly the 11 rows the design
    enumerates, and none of the 4 new legal pairs appears among them — the
    "audit confirms no removals needed" claim is true.
    (`OrderServiceTransitionTests.cs`)
20. `ValidateTransition` reason-rule tests already live in
    `OrderServiceValidationTests.cs` (Cancel_without_reason, Cancel_with_reason,
    Reason_over_140, Forward_transition_with_reason/without) — the Finding-8
    placement is correct.
21. `TransitionAsync` reads role via `http.User.GetRole()`, validates body
    before loading state, and the `StudentCancel`/`VendorAction` branches are as
    described; `userId.Value` is available to pass as `p_actor`.
    (`Endpoints/OrdersEndpoints.cs`)
22. `VendorContext` has `mapVendor`, `vendors` read via `select('*')`,
    `updateVendorInfo` patch builder with `phone` handling, `setPreorderEnabled
    (id, on)`, and `getVendor` bound to the full `vendors` list — every §2.5
    hook target exists. (`src/context/VendorContext.jsx`)
23. Dashboard `loadOrders` buckets: `done.push` carries `daysAgo` but **no**
    `placedAt`; `live.push` carries `placedAt` but no `daysAgo`; `allHistory`
    prepends completed live orders with `daysAgo: 0` (which do carry
    `placedAt`). The Finding-3 inconsistency analysis is exactly right.
    (`src/pages/Dashboard.jsx` ~L1480/1534)
24. `const setPreorder = (on) => setPreorderEnabled(vid, on)` exists verbatim;
    `RANGES` = Today/7/30/All; `DashboardTab` owns range + revenue; `OrdersTab`
    filters by `STATUS_ORDER` so the new pre-payment states already won't appear
    in the Incoming queue (FR3.1/AC7 holds). (`Dashboard.jsx`)
25. CSV `exportReport` exists in `AccountTab`; the PDF is an additive sibling,
    not a replacement. (`Dashboard.jsx`)
26. `OrderStatus.jsx` has `STATE_UI`, `DB_STATUS_TO_STEP`, a `cancelOrder`
    reason-prompt handler, a `fetchOrder` whose select must be extended, and a
    cancel button that renders **only** on the `pending` step — so Findings 2/4
    (no cancel entry point for pre-payment states; need an explicit
    payment-details-unavailable state) are real. `getVendor(order.vendorId)` is
    used, matching the pinned full-list invariant. (`src/pages/OrderStatus.jsx`)
27. Admin orders SELECT is
    `select('code, vendor_id, status, pickup_name, subtotal, total, placed_at')`
    with **no `id`**, and `OrdersPanel` rows are keyed by `o.code` — the Rev-2
    Finding-3 UUID gap is confirmed and the fix is required. (`src/pages/Admin.jsx`)
28. `Admin.jsx` Vendors panel uses a **direct admin SELECT**
    (`vendors.select('*')`), independent of `VendorContext`; `VendorRow` holds
    the `run()` write helper the approval buttons reuse. (`Admin.jsx`)
29. `Cart.jsx` already `navigate('/order/' + resp.id)` after `postOrder`, and
    has the `checkout__pay` ("Pay cash upon pickup") block and `checkout__fine`
    note the design rewrites — so "no new route needed" is accurate.
    (`src/pages/Cart.jsx`)
30. `api.js` exposes `postOrder` and a generic `transitionOrder(id, body)`;
    adding `submitPayment` is additive. (`src/lib/api.js`)
31. `VendorStore.jsx` resolves via `getVendor(id)`, renders `NotFound` when
    undefined, and computes `canOrder = preorderEnabled && isOpen` — the
    proposed `approvalStatus !== 'approved' ⇒ canOrder = false` hooks in cleanly.
    (`src/pages/VendorStore.jsx`)
32. `package.json` has no `jspdf`/`jspdf-autotable` and no other pinned
    PDF tooling; deps use carets today but the design pins the two new ones
    exactly per NFR4. (`package.json`)
33. `supabase/README.md` exists with an ordered, numbered apply list — the
    0008→0009→0010 steps and the operator "run 0009 separately" note fit the
    existing structure. (`supabase/README.md`)
34. The `FOR UPDATE` lost-race guard inside `transition_order`, the
    `place_order` status-default reliance, and the "browser never writes orders"
    invariant are all as the design describes.

## Unverified / Wrong Assumptions

No assumption in the design was found to be **wrong** against the worktree.

The following are **unverified** — true external/runtime dependencies the design
itself already flags, which cannot be confirmed from source alone and are not
counted as findings:

- The hosted Supabase `storage` schema (`storage.buckets`, `storage.objects`)
  exists on the target project. The design flags this as a prerequisite and the
  worktree has no `storage.*` DDL (there is no local Supabase stack to inspect),
  so this is accepted as an environment precondition, not a defect.
- jspdf `2.5.2` + jspdf-autotable `3.8.4` runtime compatibility and that the
  table plugin's 3.x line targets jspdf 2.x — a version-compat claim that can
  only be confirmed by installing and building (`npm run build`), which is an
  implementation-phase check.
- No automated DB/integration test harness exists, so the RLS/RPC/storage-policy
  behavior is verified manually per the design's checklist; this review confirms
  the *shape* of those policies/RPCs against existing SQL style but cannot
  execute them.
