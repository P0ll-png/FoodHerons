# Implementation Plan — Phase B + Phase B2 (FoodHerons frontend Supabase migration)

Scope: FRONTEND ONLY, done entirely in the worktree
`c:\Users\paulc\Projects\FoodHerons\.worktrees\phase-b-frontend` (branch `phase-b-frontend`).
Do NOT build the C# order service (Phase C) and do NOT edit SQL under `supabase/` (Phase A, merged).
Order placement and status-transition WRITES are NOT implemented this phase — leave them as clearly-marked
Phase-C TODO placeholders. Never write orders/order_items directly to Supabase (RLS forbids it anyway).

Baseline verified: `npm run build` in the worktree succeeds today (75 modules transformed). Every item below
must keep the build green. There is no frontend test runner (`package.json` has only dev/build/preview scripts),
so verification is `npm run build` plus the targeted grep checks noted per item. The coder MUST run the build
from the worktree root, not the main checkout.

## Ground-truth facts established during exploration (do not re-derive; verify if editing)

- Supabase client dep `@supabase/supabase-js@^2.118.0` is already installed in the worktree node_modules.
- DB schema (from `supabase/migrations/0003_tables.sql`) uses snake_case columns. The frontend uses camelCase.
  The mapping layer lives in `VendorContext` (see item 6). Key column names:
  - `vendors`: `id, owner_id, name, category, location_area, description, hours_open, hours_close,
    rating, review_count, phone, preorder_enabled, cover_tint, logo_url, cover_url`.
  - `menu_items`: composite PK `(vendor_id, id)`; `id, vendor_id, name, price, category, available,
    description, image_url, sort_order`.
  - `categories`: `id, name, image, sort_order`. `location_areas`: `id, name, sort_order` (id == display value, e.g. `'Food Court'`).
  - `orders`: `id (uuid), code, student_id, vendor_id, status, subtotal, total, pickup_name, note,
    cancel_reason, placed_at, accepted_at, ready_at, completed_at, cancelled_at`.
  - `order_items`: `id, order_id, menu_item_id, vendor_id, name, unit_price, qty`.
  - `reviews`: `id, vendor_id, student_id (DEFAULT auth.uid()), order_id (NOT NULL), author_name,
    ordered_summary, rating (1..5), text, helpful_count, created_at`. `(student_id, vendor_id, order_id)` unique.
  - `favorites`: PK `(student_id, vendor_id)`, `student_id` DEFAULT auth.uid().
  - `profiles`: `id, role (enum student|vendor|admin, lowercase), full_name, email, mobile, avatar_url`.
- RLS facts (from `0005_rls.sql`) the client queries MUST respect:
  - categories/location_areas/vendors/menu_items/reviews: public SELECT (anon ok).
  - orders/order_items: client SELECT only (student sees own, vendor sees owned-vendor, admin sees all).
    **No client INSERT/UPDATE** — those are the C# service's job (Phase C).
  - reviews INSERT: student only, `WITH CHECK student_id = auth.uid() AND order is completed+owned`.
    Client sends ONLY `{ vendor_id, order_id, rating, text }`; `student_id` is DEFAULT, `author_name` and
    `ordered_summary` are trigger-filled (un-spoofable, by `set_review_snapshot`).
  - profiles: own-row-only SELECT/UPDATE (admin may read/write any). Role is immutable by non-admins
    (guard_profile_role trigger).
  - vendors UPDATE: owner or admin; a BEFORE UPDATE trigger (`guard_vendor_columns`) rejects client writes to
    `owner_id` (except admin), `rating`, `review_count`. So vendor/admin store edits must NOT send those columns
    (admin may send `owner_id`).
  - favorites: own INSERT/DELETE; no UPDATE (change = delete+insert).
- Signup trigger (`handle_new_user`, `0004`) reads EXACTLY these `raw_user_meta_data` keys:
  `full_name`, `role`, `mobile`, `store_name`, `store_slug`. The browser signup path IGNORES `store_slug`
  and slugifies `store_name`. So the signup call MUST send `options.data` keys named exactly
  `full_name`, `role`, `mobile`, `store_name` (omit `store_slug` for browser signups).
- Real `src/data/` import consumers (code, not comments): `VendorContext.jsx`, `Dashboard.jsx`, `Home.jsx`,
  `Search.jsx`, `Profile.jsx`, `VendorCard.jsx`, `VendorStore.jsx`. `ReviewsModal.jsx` has only a stale comment
  (no import) and receives reviews via props from `VendorStore`.
- Divergences from the design's line cites (resolved here; code is authoritative):
  - `Header.jsx` uses capitalized `user?.role === 'Vendor'` (`:18`) and a `profilePath` with only two roles.
    The always-visible preview `/profile` link is in the logged-OUT branch (`Header.jsx:55-60`), not a separate block.
  - `AuthContext.jsx` user shape today is `{ name, email, role, mobile, avatar }` (camel `name`/`avatar`),
    role capitalized `'Student'`. The design's target shape is `{ id, email, role, full_name, mobile, avatar_url }`.
    Many components read `user.name` and `user.avatar` (Header, Profile). DECISION: adopt the design's canonical
    shape `{ id, email, role, full_name, mobile, avatar_url }` and update every consumer of `user.name`/`user.avatar`
    to `user.full_name`/`user.avatar_url` (Header.jsx, Profile.jsx). Grep `user.name` / `user?.name` / `user.avatar`
    before finishing to catch all sites.
  - `Cart.jsx:23` checks `user?.role === 'Student'` — switch to lowercase `'student'`.
  - `OrderStatus.jsx` uses `sessionStorage` + a `setTimeout` auto-advance and step labels `accepted` (the DB term
    is `preparing`). Map `preparing -> "Accepted"` label on read.
  - `Dashboard.jsx` `currentVendorId` is "first preorder-enabled seed"; becomes the logged-in vendor's owned store.
  - `Profile.jsx` has `PREVIEW_USER` and a commented-out `/login` redirect (`:734` in the design; in current code it
    is the line `// if (!auth.user) return <Navigate to="/login" replace />`). Restore the redirect, drop PREVIEW_USER.
  - Profile/Dashboard use client-side password-change/delete stubs with TODO comments; wire `changePassword` to real
    Supabase, keep `deleteAccount` throwing an honest error.

---

- [ ] 1. Create the browser Supabase client `src/lib/supabase.js`.
      Export a singleton created with `createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)`
      using the PUBLISHABLE/anon key (NEVER the service-role key). If either env var is missing, throw a clear runtime
      Error at client-init (module load / first use) — NOT a build-time failure. Keep default session persistence.
      Files: `src/lib/supabase.js` (new)
      Verify: `npm run build` succeeds. (Import is exercised by later items.)

- [ ] 2. Create env/config templates at the worktree root.
      Create `.env.example` (tracked, placeholders only) with:
      `VITE_SUPABASE_URL=`, `VITE_SUPABASE_ANON_KEY=`, `VITE_API_BASE_URL=/api`, plus a comment that real values go
      in `.env.local` (git-ignored) and that `VITE_SUPABASE_ANON_KEY` is the public anon/publishable key (RLS protects
      data; the service-role key must NEVER appear here). Ensure `.env.example` is TRACKED: the root `.gitignore`
      already ignores `.env.*`; add a root-level `!.env.example` negation AFTER the `.env.*` line (the existing
      `!supabase/scripts/.env.example` negation is unrelated and must stay). Do NOT create `.env.local` with real values;
      do NOT hardcode keys.
      Files: `.env.example` (new), `.gitignore` (add one negation line)
      Verify: `git check-ignore .env.example` returns non-zero (i.e. the file is NOT ignored / is trackable);
      `git status --porcelain .env.example` shows it as an untracked/added file. `npm run build` still succeeds.

- [ ] 3. Rewrite `src/context/AuthContext.jsx` to wrap Supabase Auth.
      Remove `DEMO_MODE`/`DEMO_STUDENT`/`readUser()` localStorage shim. On mount call `supabase.auth.getSession()`,
      then subscribe to `supabase.auth.onAuthStateChange` (unsubscribe on unmount). Expose a `loading` flag that is
      true until the first session resolves (consumed by the guards in item 4). When a session exists, fetch the
      caller's `profiles` row (`select id, role, full_name, email, mobile, avatar_url from profiles where id = <uid>`)
      and set `user = { id, email, role, full_name, mobile, avatar_url }` (role is lowercase from the enum). On
      SIGNED_OUT set `user = null`.
      Functions: `login({email,password})` -> `supabase.auth.signInWithPassword`; `logout()` -> `supabase.auth.signOut`;
      `signup({name,email,phone,password,role,store})` -> `supabase.auth.signUp({ email, password, options: { data: {
      full_name: name, role, mobile: phone, store_name: role === 'vendor' ? store : null } } })` (DO NOT send `store_slug`);
      `updateUser(patch)` -> `supabase.from('profiles').update(<mapped columns>).eq('id', user.id)` then refresh local
      user (map `name->full_name`, `avatar->avatar_url` if callers pass camel keys; prefer updating callers to pass
      `full_name`/`avatar_url`); `changePassword({next})` -> `supabase.auth.updateUser({ password: next })`;
      `deleteAccount` keeps throwing `new Error('Account deletion is not available yet.')`.
      Keep the `useAuth()` hook and provider contract; add `loading` and `signup` to the context value.
      Files: `src/context/AuthContext.jsx`
      Verify: `npm run build` succeeds; grep confirms `DEMO_MODE`/`PREVIEW_USER`/`readUser` no longer appear in AuthContext.

- [ ] 4. Add route guards and the `/admin` route in `src/App.jsx`.
      Add `RequireAuth` (renders children if `useAuth().user` exists, else `<Navigate to="/login" replace />`) and
      `RequireRole({ role, children })` (renders children if `user?.role === role`, else redirect: unauthenticated ->
      `/login`, wrong role -> `/`). While `useAuth().loading` is true, render a lightweight splash (e.g. a centered
      "Loading…" div) to avoid redirect flicker before `getSession()` resolves. Gate the routes: `/profile` ->
      `RequireRole role="student"`; `/dashboard` -> `RequireRole role="vendor"`; `/admin` (NEW) ->
      `RequireRole role="admin"` rendering a new `Admin` page; `/cart` and `/order/:id` -> `RequireAuth`;
      `/`, `/search`, `/vendor/:id`, `/login`, `/signup`, `*` stay public. Import the new `src/pages/Admin.jsx`.
      (The guards may live in `App.jsx` or a small `src/components/RouteGuards.jsx` — either is fine; keep it simple.)
      Depends on: item 3 (loading flag), item 15 (Admin page must exist to import — create a minimal stub in this item
      if ordering requires, then flesh out in item 15; OR order item 15 before build).
      Files: `src/App.jsx` (+ optional `src/components/RouteGuards.jsx`)
      Verify: `npm run build` succeeds.

- [ ] 5. Update `src/components/Header.jsx` for real roles + admin link; drop the preview link.
      Switch `profilePath` (currently `user?.role === 'Vendor' ? '/dashboard' : '/profile'`) to lowercase and three
      roles: `role === 'admin' ? '/admin' : role === 'vendor' ? '/dashboard' : '/profile'`. Make the hard-coded
      "Vendor Dashboard" NavLink role-conditional: show "Vendor Dashboard" -> `/dashboard` for vendors, "Admin" ->
      `/admin` for admins, hidden for students/anonymous. Remove the always-visible "frontend preview only" `/profile`
      NavLink in the logged-out branch. Update `user?.name` -> `user?.full_name` and `user.avatar` -> `user.avatar_url`
      for the profile chip/avatar.
      Files: `src/components/Header.jsx`
      Verify: `npm run build` succeeds; grep Header for `'Vendor'` (capitalized) returns nothing.

- [ ] 6. Make `src/context/VendorContext.jsx` Supabase-backed (reads + camelCase mapping + owner-scoped writes).
      Replace `seedVendors`/`loadVendors()`/localStorage with a fetch: on mount `select *` from `vendors` and
      `select *` from `menu_items` (public SELECT), then group menu items under their vendor and map snake_case ->
      the camelCase shape the UI already consumes: `{ id, name, category, locationArea: location_area, description,
      hoursOpen: hours_open, hoursClose: hours_close, rating, reviews: review_count, phone,
      preorderEnabled: preorder_enabled, coverTint: cover_tint, logo: logo_url, cover: cover_url, menu: [{ id, name,
      price, category, available, desc: description, image: image_url }] }`. Keep `isOpenNow()` and the per-minute
      `now` tick exactly as-is (pure client). Expose a `loading` flag; while loading, provide `vendors: []`.
      `currentVendorId`: derive from the logged-in vendor's owned store — the vendor row whose `owner_id` equals
      `useAuth().user.id` (consume `useAuth()`; AuthProvider already wraps VendorProvider in App.jsx). If none, leave null.
      Rewrite the dashboard edit functions as Supabase writes (RLS/owner-guarded), then refresh local state (re-fetch or
      optimistic patch): `updateVendorInfo(id, info)` -> `supabase.from('vendors').update({ name, description, category,
      location_area, hours_open, hours_close, phone, logo_url, cover_url }).eq('id', id)` (map camel->snake; NEVER send
      `owner_id`/`rating`/`review_count`); `setPreorderEnabled(id, on)` -> update `preorder_enabled`;
      `saveMenuItem(id, item)` -> `supabase.from('menu_items').upsert({ vendor_id: id, id: item.id, name, price,
      category, available, description: item.desc, image_url: item.image })` (composite PK (vendor_id,id));
      `setItemAvailable(id, itemId, available)` -> update `available` where `(vendor_id, id)`;
      `deleteMenuItem(id, itemId)` -> delete where `(vendor_id, id)`. Mark any write that fails RLS with a surfaced
      console error; do not swallow silently.
      Depends on: item 3 (useAuth), item 1 (supabase client).
      Files: `src/context/VendorContext.jsx`
      Verify: `npm run build` succeeds. (CartContext already reads menu via `getVendor`; no change needed — confirm it
      still compiles.)

- [ ] 7. Replace `categoryName` lookups in `VendorCard.jsx`, `Search.jsx`, `VendorStore.jsx` with a context-sourced lookup.
      Add `categories` (and `locationAreas`) to VendorContext from the `categories`/`location_areas` tables
      (public SELECT, fetched once alongside vendors in item 6) and expose a `categoryName(id)` helper from the context
      (returns `categories.find(c => c.id === id)?.name ?? id`). Update the three files to import the helper from
      `useVendors()` instead of `../data/vendors`. This is one change pattern across three files.
      Depends on: item 6.
      Files: `src/components/VendorCard.jsx`, `src/pages/Search.jsx`, `src/pages/VendorStore.jsx`
      Verify: `npm run build` succeeds; grep these three files for `data/vendors` returns nothing.

- [ ] 8. Source `Home.jsx` categories + locationAreas from context/tables.
      Replace `import { categories, locationAreas } from '../data/vendors'` with the context-provided `categories`
      (array of `{id,name,image}`) and `locationAreas` (array of `{id,name}` from `location_areas`, ordered by
      `sort_order`). The area `<select>` currently maps `locationAreas.map((a) => <option value={a}>{a}</option>)`
      where `a` is a string; update it to use `a.id`/`a.name` (id === display value in the seed). The vendor list
      already comes from `useVendors()`.
      Depends on: item 6/7.
      Files: `src/pages/Home.jsx`
      Verify: `npm run build` succeeds; grep Home for `data/vendors` returns nothing.

- [ ] 9. Rewire `src/pages/VendorStore.jsx` reviews to real Supabase data (READ-ONLY here).
      Replace `getReviewsFor(vendor)` with a Supabase select of real reviews for the vendor:
      `supabase.from('reviews').select('id, author_name, ordered_summary, rating, text, helpful_count, created_at')
      .eq('vendor_id', id).order('created_at', { ascending: false })`. Map rows to the shape `ReviewsModal` expects:
      `{ id, name: author_name, rating, text, ordered: ordered_summary, helpful: helpful_count, createdAt: created_at }`.
      The "Ordered:" line reads `ordered_summary` directly — NO `order_items` join (anonymous audience can't read it).
      `rating`/`reviews` count come from the vendor row (already `vendor.rating`/`vendor.reviews`). Keep `categoryName`
      via the context helper (item 7). Do NOT add review submission here (read-only). Handle the empty array -> the
      modal's existing "No reviews yet" state.
      Depends on: items 1, 6, 7.
      Files: `src/pages/VendorStore.jsx`
      Verify: `npm run build` succeeds; grep VendorStore for `data/reviews` returns nothing.

- [ ] 10. Rewire `src/pages/Profile.jsx` to Supabase, restore the student redirect, wire review submit.
      Remove `import { vendors as ALL_VENDORS }` (use `useVendors()` + the existing `toVendor` adapter, feeding it real
      vendor rows) and remove `import { ACTIVE_ORDERS, ... } from '../data/studentSample'`. Remove `PREVIEW_USER`;
      restore the redirect: `if (!auth.user) return <Navigate to="/login" replace />` (keep the existing
      `user.role === 'Vendor'` redirect but switch to lowercase `'vendor'`). Replace the sample arrays with Supabase
      fetches scoped to `auth.uid()` (RLS enforces ownership — do not add explicit student_id filters beyond what the
      UI needs, but `.eq('student_id', user.id)` is fine and clear):
      - Orders: `supabase.from('orders').select('id, code, vendor_id, status, total, placed_at,
        order_items(name, qty, unit_price)').eq('student_id', user.id).order('placed_at', { ascending: false })`.
        Split into active (status in pending/preparing/ready) vs past (completed/cancelled) for the two tabs. Map status
        to the existing `STATUS_PILL` labels (map `preparing`->`Preparing`/`Accepted` per the pill map).
      - Favorites: `supabase.from('favorites').select('vendor_id').eq('student_id', user.id)`; resolve each to a vendor
        via `useVendors().getVendor`. Removing a favorite -> `supabase.from('favorites').delete().eq('student_id',
        user.id).eq('vendor_id', vendorId)`.
      - Reviews (past): `supabase.from('reviews').select('id, vendor_id, rating, text, created_at,
        ordered_summary').eq('student_id', user.id)`. Pending reviews = the student's completed orders that have no
        matching review row yet (compute from the completed orders + existing reviews' `order_id`s). Each pending entry
        must carry its `order_id` (uuid) and `vendor_id`.
      - Review SUBMIT (from the PENDING_REVIEWS "Write a review" form): `supabase.from('reviews').insert({ vendor_id,
        order_id, rating, text })` — send ONLY those four fields (student_id/author_name/ordered_summary are DB-filled).
        On success move the item from pending to past.
      Wire `changePassword`/`deleteAccount` to the real `auth` functions already passed down (item 3 made them real/honest).
      Update `user.name`->`user.full_name`, `user.avatar`->`user.avatar_url`, `user.mobile` stays, role badge uses lowercase.
      Depends on: items 1, 3, 6.
      Files: `src/pages/Profile.jsx`
      Verify: `npm run build` succeeds; grep Profile for `studentSample`, `PREVIEW_USER`, `ALL_VENDORS` returns nothing.

- [ ] 11. Rewire `src/pages/OrderStatus.jsx` to read the real order via Supabase; wire review submit; remove the timer.
      Replace `loadOrder(id)` (sessionStorage) and the `setTimeout` auto-advance `useEffect` with a Supabase fetch of
      the order by UUID: `supabase.from('orders').select('id, code, vendor_id, status, total, pickup_name, note,
      order_items(name, qty, unit_price)').eq('id', id).single()` (RLS: student sees own). Derive the displayed step
      from the real `status` (map DB `preparing` -> the UI's `accepted` step label). Resolve the vendor via
      `useVendors().getVendor(order.vendor_id)` for name/location/hours/phone. The order object the JSX reads
      (`order.id`, `order.vendorName`, `order.lines`, `order.total`, `order.pickupName`, `order.note`) must be adapted
      from the DB row: `id = code` (human display) but keep the UUID for the review insert; `vendorName = vendor?.name`;
      `lines = order_items.map(oi => ({ name: oi.name, qty: oi.qty, price: oi.unit_price }))`.
      Completed-state "Leave a review" button: replace the empty `/* TODO */` onClick with a review form (rating + text)
      that inserts `supabase.from('reviews').insert({ vendor_id: order.vendor_id, order_id: <order UUID>, rating, text })`.
      Student-cancel button: replace `handleCancel` (currently removes the sessionStorage blob) with a clearly-marked
      Phase-C TODO placeholder (e.g. an alert/disabled state `// TODO(Phase C): POST /api/orders/{id}/transition
      {to:'cancelled'}` — DO NOT write to Supabase directly). "Order not found" empty state stays for a missing/RLS-denied row.
      Depends on: items 1, 6.
      Files: `src/pages/OrderStatus.jsx`
      Verify: `npm run build` succeeds; grep OrderStatus for `sessionStorage` and `setTimeout` returns nothing.

- [ ] 12. Rewire `src/pages/Dashboard.jsx`: real orders fetch, Phase-C TODO placeholders, context writes, table categories.
      Delete `SEED_ORDERS`/`SEED_HISTORY`. Replace `categories` import from `../data/vendors` with the context
      `categories` (item 7) used in the `ItemDialog`/`ProfileTab` category `<select>`s. The store/menu edits already go
      through VendorContext (`updateVendorInfo`/`setPreorderEnabled`/`saveMenuItem`/`setItemAvailable`/`deleteMenuItem`),
      now Supabase-backed (item 6) — confirm they still pass `vid` and the item shape (`{id,name,desc,price,category,
      available,image}`). Fetch real orders for the owned vendor: `supabase.from('orders').select('id, code, pickup_name,
      status, total, placed_at, cancel_reason, order_items(name, qty)').eq('vendor_id', currentVendorId).order('placed_at',
      { ascending: false })`, then adapt into the shapes `OrdersTab`/`DashboardTab` consume (the current code uses
      `o.id`, `o.name`, `o.items` (a "2× X, 1× Y" string), `o.total`, `o.status`, `o.placedAt`, `o.daysAgo`). Build the
      `items` string from `order_items` (`qty + '× ' + name` joined by ', '); `name` <- `pickup_name`; `id` <- `code`;
      `placedAt` <- `Date.parse(placed_at)`; split completed into history. The order action buttons (accept/ready/
      complete/reject via `changeStatus`/`reject`) become clearly-marked Phase-C TODO placeholders — DO NOT write order
      status to Supabase. Keep the optimistic local state update ONLY if it is clearly labelled as a temporary UI-only
      stand-in for the Phase-C service call, OR disable the buttons with a "Managed by order service (coming soon)"
      note; either is acceptable, but no direct Supabase order write. The CSV export and finance report compute from the
      fetched (read-only) orders.
      Depends on: items 1, 3, 6, 7.
      Files: `src/pages/Dashboard.jsx`
      Verify: `npm run build` succeeds; grep Dashboard for `SEED_ORDERS`/`SEED_HISTORY`/`data/vendors` returns nothing.

- [ ] 13. Rewire `src/pages/Cart.jsx`: lowercase role, Phase-C placeholder for placeOrder.
      Change `user?.role === 'Student'` to `'student'`. Replace the `placeOrder` body (the `FH-` id generation + order
      object + `sessionStorage.setItem('order-...')` + navigate) with a clearly-marked Phase-C TODO placeholder that
      does NOT write to Supabase and does NOT fabricate a sessionStorage order. Minimal acceptable behavior: on submit,
      show a clear "Order placement is coming soon (handled by the order service)" message (inline alert or disabled
      button state) and keep the cart intact. Comment it `// TODO(Phase C): POST /api/orders then navigate('/order/'+id)`.
      Keep the rest of the cart client-side (CartContext unchanged; it already reads menu via `useVendors()`).
      Depends on: item 3.
      Files: `src/pages/Cart.jsx`
      Verify: `npm run build` succeeds; grep Cart for `sessionStorage` returns nothing and for `=== 'Student'` returns nothing.

- [ ] 14. (Phase B2) Create `src/pages/Admin.jsx` — the admin management console, gated by `RequireRole role="admin"` (item 4).
      Three stacked panels (reuse the app's tabbed layout convention; keep it a functional console, not analytics):
      (a) Manage vendors — `supabase.from('vendors').select('*')` (admin SELECT = all) annotated with owner name/email
          via `supabase.from('profiles').select('id, full_name, email')` (admin may read any profile). Per vendor:
          * Assign/change owner (the "claim" tool): `supabase.from('vendors').update({ owner_id: <profiles.id> })
            .eq('id', vendorId)` — pick a user by email from the profiles list (admin RLS + column guard permit admin
            owner_id changes).
          * Toggle `preorder_enabled`: `.update({ preorder_enabled })`.
          * Edit store info (name/category/location_area/hours_open/hours_close/phone/logo_url/cover_url):
            `.update({ ...columns })` parameterized by the SELECTED vendor id (NOT `currentVendorId`). Reuse the
            VendorContext write SHAPE/column set, but issue it against the chosen vendor id. NEVER send rating/review_count.
          Build a lightweight admin row component that reuses VendorCard's open/closed + preorder badges and the
          `categoryName()` label, but NOT its `<Link>` click (inline controls instead).
      (b) Moderate reviews — `supabase.from('reviews').select('id, vendor_id, author_name, ordered_summary, rating,
          text, created_at')` with a vendor-name annotation (from the vendors list) and a delete action
          `supabase.from('reviews').delete().eq('id', reviewId)` (admin DELETE policy). Deleting fires the
          reviews->vendor aggregate trigger, so rating/review_count self-correct (re-fetch after delete to reflect).
      (c) View all orders (read-only) — `supabase.from('orders').select('code, vendor_id, status, pickup_name,
          subtotal, total, placed_at').order('placed_at', { ascending: false })` (admin SELECT = all). Display status,
          vendor, pickup name, code, totals, placed-at. NO status mutation (Phase C owns order writes).
      Add an `Admin.css` if the app uses per-page CSS (it does — mirror the Dashboard/Profile pattern); otherwise reuse
      existing classes. Uses the shared supabase client and `useAuth()`/`useVendors()`.
      Depends on: items 1, 3, 4, 6, 7.
      Files: `src/pages/Admin.jsx` (new), optional `src/pages/Admin.css` (new). (If item 4 created an Admin stub, this
      replaces it.)
      Verify: `npm run build` succeeds.

- [ ] 15. Delete the three seed data files AFTER every consumer is rewired; confirm zero imports first.
      Grep the whole `src/` for any remaining import from `src/data/` (`../data/vendors`, `../data/reviews`,
      `../data/studentSample`, and `getVendor`/`getReviewsFor`/`categoryName`/`categories`/`locationAreas`/`vendors`/
      `ACTIVE_ORDERS` etc. sourced from there). Only when the grep returns ZERO import statements, delete
      `src/data/vendors.js`, `src/data/reviews.js`, `src/data/studentSample.js`. Also update the stale
      `ReviewsModal.jsx` comment (`Placeholder reviews come from ../data/reviews.js.`) so it no longer references the
      deleted file (comment-only; no logic change). Any small static constant that must survive comes from the
      `categories`/`location_areas` tables (via context), not a re-introduced seed file.
      Depends on: items 6–14 (all consumers rewired).
      Files: delete `src/data/vendors.js`, `src/data/reviews.js`, `src/data/studentSample.js`; edit `src/components/ReviewsModal.jsx` (comment)
      Verify: `rg -n "data/(vendors|reviews|studentSample)" src` (or the grep tool) returns ZERO import lines;
      `npm run build` succeeds after deletion (this is the Phase B build acceptance: still ~75-or-fewer modules, green).

- [ ] 16. Final full verification pass.
      Run the production build from the worktree root and confirm it is green. Confirm no secrets are committed
      (`git status` shows no `.env`/`.env.local`; only `.env.example` is tracked). Confirm `@supabase/supabase-js`
      remained a dependency (`^2.118.0`). Spot-check by grepping `src/` that there are no remaining references to
      `DEMO_MODE`, `PREVIEW_USER`, `sessionStorage.setItem('order-`, or direct order/order_items Supabase writes
      (`from('orders').insert`/`.update`, `from('order_items').insert`).
      Files: none (verification only)
      Verify: `npm run build` succeeds; the greps above return nothing.

## Notes / assumptions

- No frontend test runner exists; `npm run build` + targeted greps are the verification contract (consistent with the
  design's Phase B "done/verified": build passes, guards redirect, no remaining `src/data/` imports).
- `.env.local` with real values is the user's responsibility (the design §6 getting-started notes); the plan only ships
  `.env.example`. The client must not require the vars to COMPILE — the missing-var error is a runtime throw at
  client-init (item 1), so the build stays green without any env file.
- If item 4 needs `Admin.jsx` to exist before item 14, create a one-line placeholder component in item 4 and flesh it out
  in item 14, OR implement item 14 before the item-4 build — the coder should pick one and keep each commit buildable.
- Role casing is lowercase `student`/`vendor`/`admin` everywhere in code; UI labels may stay capitalized at render.
