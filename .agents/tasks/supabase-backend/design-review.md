# Design Review — FoodHerons Supabase + C# Backend Integration (Revision 5)

Reviewer: fresh design-review pass (no authoring context). Scope: `design.md` Revision 5 and the real source under `src/`. Design-only review — no code/SQL/scaffolding was written.

**Verdict: APPROVED** (0 HIGH, 0 MEDIUM, 5 NIT).

The document stands on its own, the architecture is internally consistent, the admin role (Change 1) and the seed demo-account path (Change 2) are complete and safe, and all three Revision-5 structural fixes are actually reflected in the body — not merely claimed in the "Responses to review findings" section. Every finding below is a line-citation drift (the class the prior rounds also treated as NIT). None blocks implementation; an implementer can close them inline while coding. Per the mechanical rule (HIGH+MEDIUM = 0), the verdict is APPROVED.

---

## Findings

### 1. [NIT] Rev-5 fix #5 (`App.jsx` routes-block citation → `:40-50`) was applied in only one of three places
**Location:** `design.md` §5 "Files to remove / rewire" table, `src/App.jsx` row (line ~581); and the Change-1 recap "Routes/nav" bullet (line ~765).
**Problem:** The Rev-5 fix claims the `App.jsx` routes-block citation was "corrected to `:40-50`." §3 (line ~347) was correctly updated to `App.jsx:40-50`, but two other occurrences still read the stale `App.jsx:42-50`. Verified against source: `App.jsx` has `<Routes>` at line 39, the `<Route>` entries at lines 40–49, and `</Routes>` at line 50. `:42-50` starts at `/vendor/:id` and drops the first two routes (`/`, `/search`), so it is the wrong span; `:40-50` is correct. The fix is thus only two-thirds applied, leaving an internal inconsistency within the doc.
**Fix:** Change both remaining `App.jsx:42-50` citations to `App.jsx:40-50` (the §5 rewire-table row and the Change-1 "Routes/nav" recap bullet).

### 2. [NIT] `AuthContext.jsx:11,37` — the second capitalized `'Student'` is at line 33, not 37
**Location:** `design.md` §3 "Session handling in React," normalization note ("the current code is inconsistent — `AuthContext`/`Header` use capitalized `'Student'`/`'Vendor'` (`AuthContext.jsx:11,37`, `Header.jsx:18`)").
**Problem:** Verified against source: `role: 'Student'` appears at line 11 (`DEMO_STUDENT`) — correct — and at line 33 (`const next = { role: 'Student', ... }` inside `login`). There is no capitalized role literal at line 37 (line 33–35 is the `login` body; 37+ is `updateUser`). The citation should be `:11,33`.
**Fix:** Change `AuthContext.jsx:11,37` to `AuthContext.jsx:11,33`.

### 3. [NIT] §5 demo-account table store-name citations are each off by one (point at the `id:` line, not the `name:` line)
**Location:** `design.md` §5 demo-accounts parenthetical ("`Ate Len Noodle House` (`vendors.js:92`), `The Sweet Spot` (`vendors.js:111`), `Kuya Boy Smoky Grill` (`vendors.js:130`)"); echoed in the Rev-4 Finding-1 response.
**Problem:** The store-name *values* are verbatim-correct against `src/data/vendors.js` (this was the substance of the Rev-4 HIGH finding, and it holds — determinism is preserved). But the line numbers point one line high, at each store's `id:` line rather than its `name:` line. Verified: `name: 'Ate Len Noodle House'` is at line **91** (not 92); `name: 'The Sweet Spot'` at line **110** (not 111); `name: 'Kuya Boy Smoky Grill'` at line **129** (not 130).
**Fix:** Change `:92`→`:91`, `:111`→`:110`, `:130`→`:129`. (The names themselves need no change.)

### 4. [NIT] `isOpenNow()` cited as `VendorContext.jsx:22-27`; the function is at lines 21–26
**Location:** `design.md` §1 vendors note ("derived at read time ... by the existing `isOpenNow()` helper in `VendorContext.jsx:22-27`").
**Problem:** Verified: `export const isOpenNow = (open, close, date = new Date()) => {` is at line **21** and the function closes at line **26** (the non-wrap branch `start <= end ? m >= start && m < end` is at line 25). The cited `:22-27` is off by one at both ends. The helper is otherwise correctly identified and the `00:00`/`00:00` "always closed" reasoning in §1 is sound.
**Fix:** Change `VendorContext.jsx:22-27` to `VendorContext.jsx:21-26`.

### 5. [NIT] `currentVendorId` cited as `VendorContext.jsx:48-50`; the declaration starts at line 47
**Location:** `design.md` §5(a) admin-dashboard parameterization note ("those `VendorContext` functions target the logged-in vendor's own store via `currentVendorId` (`VendorContext.jsx:48-50`)").
**Problem:** Verified: `const currentVendorId = useMemo(` is at line **47**; the body `() => (seedVendors.find((v) => v.preorderEnabled) ?? seedVendors[0]).id` is at line 49 and the deps `[]` at line 50. The construct spans 47–51. The cited `:48-50` starts one line late (it points at the comment/first-arg boundary rather than the declaration).
**Fix:** Change `VendorContext.jsx:48-50` to `VendorContext.jsx:47-51` (or `:47-50` to match the declaration start).

---

## Verified Assumptions (checked against real source / repo)

- **Rev-5 fix #1 — caller-based slug branch (MEDIUM, resolved).** §3's "Vendor slug `id` — rule" (lines 309–313) genuinely branches on `current_setting('request.jwt.claims', true) IS NULL` (caller), not on the client `store_slug` flag. The service/seed path honors `store_slug` + `ON CONFLICT (id) DO NOTHING`; **any JWT-bearing browser caller ignores `store_slug` entirely** and always takes the slugify (`lower(regexp_replace(store_name,'[^a-z0-9]+','-','gi'))`) + numeric-suffix, conflict-surfacing INSERT. The silent `DO NOTHING` skip is unreachable from the browser, so a self-signup can neither target a seed slug nor end up store-less. Correctly reflected in the body, not just claimed.
- **Rev-5 fix #2 — lookup-first/create-if-absent seed contract (MEDIUM, resolved).** §5 contains the explicit "Seed re-run contract" paragraph: resolve each `<slug>@foodherons.local` account by email first (`admin.listUsers` / catch-duplicate), call `createUser` only when absent, then run the `owner_id`-keyed `vendors` poll-with-backoff + `UPDATE ... WHERE owner_id = $1` asserting `rowcount = 1`. It also correctly retracts the earlier over-claim that `ON CONFLICT DO NOTHING` provided re-run idempotency (the GoTrue duplicate-email rejection fires before the trigger). Present in the body.
- **Rev-5 fix #3 — `FH-000142` (NIT, resolved).** §4 `PlaceOrderResponse` (line 401) reads `"code": "FH-000142"`, matching §1's `code` column (line 119: `'FH-' || lpad(nextval('order_code_seq')::text, 6, '0')`). No stale 4-digit `FH-4833` remains in the body (only in the finding-description text explaining the correction).
- **Rev-5 fix #4 — `Cart.jsx:32-41` (NIT, resolved).** Verified in source: the `const order = { ... }` literal spans lines **32–41** exactly; `sessionStorage.setItem(\`order-${orderId}\`, …)` is at line 43; `user?.role === 'Student'` is at line 23. All three Cart.jsx citations are correct.
- **Admin role completeness & safety (Change 1).** §2's policy table applies the admin predicate across **every** content table: `profiles`, `vendors`, `menu_items`, `orders`, `order_items`, `reviews`, `favorites` (plus public-SELECT `categories`/`location_areas`). Admin gets SELECT-all on `orders`/`order_items` but **no** order write — correctly preserving the Model-2 invariant (order writes stay the C# service's). The `guard_vendor_columns` and `profiles` role-immutability triggers both open with the service-role early-return, then relax `owner_id`/`role` for an admin browser caller while keeping `rating`/`review_count` unwritable by any client. The signup-trigger privilege-escalation guard (§3 step 2) coerces any non-`vendor` client role to `student`, so `admin` is unreachable via `signUp`. `admin` is DB-assigned only; verified `Signup.jsx:17` initializes role from `?role=vendor` else `student`, and the radiogroup at `Signup.jsx:46-57` renders exactly two buttons (Student/Vendor) — no third option. Admin dashboard (§5) is concrete: three named panels with the exact write path (direct-Supabase under admin RLS) for each action.
- **File:line citations confirmed accurate** (spot-checked): `vendors.js:2` ("Supabase (MySQL)" stale comment), `vendors.js:5-12` (categories), `vendors.js:14-21` (locationAreas), `vendors.js:26` (`Tita Nena's Silog`); all 8 seed slugs match §5 exactly (`tita-nenas`, `campus-brews`, `crunch-corner`, `noodle-house`, `sweet-spot`, `smoky-grill`, `brekkie-cart`, `rice-rush`); `Signup.jsx:17` (role useState), `:18` (form useState `{name,email,phone,password,store}`), `:46-57` (radiogroup); `Cart.jsx:23/32-41/43`; `App.jsx:40-50` (the §3 occurrence); `Header.jsx:18` (`profilePath`), `:46-48` ("Vendor Dashboard" NavLink), `:55-60` (preview-only `/profile` link); `AuthContext.jsx:47-49` (`changePassword` stub), `:51-53` (`deleteAccount` stub); `Profile.jsx:6` (`vendors as ALL_VENDORS`), `:9` (studentSample), `:17` (`PREVIEW_USER`), `:734` (commented `/login` redirect); `OrderStatus.jsx` completed-state "Leave a review" button with empty `/* TODO: open your review modal / route here */` onClick (confirmed); `VendorContext.jsx:2` (seedVendors import), `:90-99` (`updateVendorInfo`/`setPreorderEnabled`).
- **`.gitignore` claim (§6).** Confirmed: the file ignores `*.local`, `.env`, `.env.*`; so `.env.local` is doubly ignored and `.env.example` matches `.env.*` — the design's requirement to add `!.env.example` negations after the `.env.*` line is correct, and the `!.vscode/extensions.json` precedent exists in the file.
- **Design-only scope.** Confirmed via repo scan: **no `.sql` files, no `.csproj`, no `supabase/` or `server/` directories** exist. `git status` shows only doc artifacts under `.agents/tasks/`; no `src/` application code was modified by this design work.
- **Prior Rev-1..Rev-4 decisions preserved.** `numeric(10,2)` money, text slug PKs, composite `menu_items` PK, snapshot `order_items` (no FK to `menu_items`), `order_code_seq`, `public.auth_role()` SECURITY DEFINER helper, Asia/Manila openness, `set_review_snapshot` trigger, one-review-per-completed-order via NULL-free unique key, client-only cart, deferred account deletion / Facebook, lowercase role casing, and the narrow C# order-service scope (placement + transitions only) are all intact and uncontradicted by Change 1/Change 2.

## Unverified / Wrong Assumptions

**Wrong (now captured as NIT findings above):**
- `App.jsx:42-50` (two sites) — stale; correct span is `:40-50` (Finding 1).
- `AuthContext.jsx:37` for the second capitalized `'Student'` — actual line 33 (Finding 2).
- `vendors.js:92 / :111 / :130` for the three store names — actual `:91 / :110 / :129` (Finding 3).
- `VendorContext.jsx:22-27` for `isOpenNow` — actual `:21-26` (Finding 4).
- `VendorContext.jsx:48-50` for `currentVendorId` — declaration starts at `:47` (Finding 5).

**Unverified (runtime/environment properties the design correctly flags as Phase-A/C confirmations, not repo-checkable — no finding):**
- `handle_new_user` running synchronously inside the GoTrue `auth.users` INSERT transaction, and the follow-up pooled connection's immediate visibility of the new `vendors` row. The design explicitly downgrades this from asserted fact to "expected behavior, confirmed in Phase A," and makes the seed deterministic regardless via poll-with-backoff + `rowcount = 1` assertion. Appropriately handled.
- The exact `current_user` role name of the seed/service connection (`postgres` vs pooler tenant vs other). The design correctly makes `request.jwt.claims IS NULL` the authoritative exemption test and treats the `current_user IN (...)` list as belt-and-suspenders confirmed in Phase A.
- GoTrue accepting `<slug>@foodherons.local` with `email_confirm: true` (syntactic-shape validation, no delivery). The design's reasoning is sound; final confirmation is a Phase-A runtime check.
- JWT signing mode (HS256 shared secret vs asymmetric JWKS) — left as Open Question 6, confirmed by the user at Phase C start. Appropriate.
- Supabase `gen_random_uuid()` / `pgcrypto` availability — called out in Phase A with a `create extension if not exists pgcrypto` fallback. Appropriate.
