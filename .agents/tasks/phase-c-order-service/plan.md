# Phase C — Implementation Plan: C# Order Service + Frontend Wiring

Authoritative design: `.agents/tasks/supabase-backend/design.md` Revision 5, §4 (C# service) + §6 (config/secrets) + §7 Phase C. All work in the worktree `c:\Users\paulc\Projects\FoodHerons\.worktrees\phase-c-order-service` on branch `phase-c-order-service`. **Do NOT modify any SQL under `supabase/`.** No secrets committed anywhere.

## Grounding facts verified during exploration

- **.NET SDK 10.0.401** is installed (`dotnet --list-sdks`). Target `net10.0`.
- **No `server/` directory exists yet** — it is created fresh by this phase.
- **`vite.config.js` already exists** (does NOT yet have `server.proxy`); it has `server: { port: 5173, open: true }`. Add `proxy` under the existing `server` block — do NOT overwrite the file wholesale.
- **`.env.example` (frontend) exists** with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL=/api` already present — no change needed there; the service needs its OWN `server/FoodHerons.Api/.env.example`.
- **`.gitignore` already covers** `.env`, `.env.*`, `*.local`, `dist`, `node_modules`. It does NOT yet cover `server/**/bin/`, `server/**/obj/`, or `server/**/.env`. Add those (and a `!server/FoodHerons.Api/.env.example` negation AFTER the `.env.*` line).
- **Supabase client token source:** `supabase.auth.getSession()` → `data.session.access_token`. The singleton client is `src/lib/supabase.js`. `AuthContext` exposes `user` but not the token, so the fetch helper reads the session directly from the supabase client.
- **Schema (from `supabase/migrations/0002_enums.sql`, `0003_tables.sql`) — exact names the queries use:**
  - `order_status` enum: `pending | preparing | ready | completed | cancelled`.
  - `menu_items` composite PK `(vendor_id, id)`; columns `id, vendor_id, name, price numeric(10,2), category, available boolean, ...`. Price/name/available read from here.
  - `vendors`: `id text PK, owner_id uuid, name, preorder_enabled boolean, hours_open text ('HH:MM', default '00:00'), hours_close text, ...`. Openness read from `hours_open`/`hours_close`; ownership from `owner_id`.
  - `orders`: `id uuid PK default gen_random_uuid(), code text unique default ('FH-' || lpad(nextval('public.order_code_seq')::text,6,'0')), student_id uuid, vendor_id text, status order_status default 'pending', subtotal numeric(10,2), total numeric(10,2), pickup_name, note, cancel_reason, placed_at, accepted_at, ready_at, completed_at, cancelled_at`. The `code` DEFAULT exists, so the INSERT can omit `code` and `RETURNING code` yields it (preferred over computing in C#).
  - `order_items`: `id uuid PK, order_id uuid FK ON DELETE CASCADE, menu_item_id text, vendor_id text, name, unit_price numeric(10,2), qty integer`. NO FK to menu_items.
  - `order_code_seq` sequence exists; do not `nextval` it manually — rely on the column default.
- **Port decision: 5080** (per §4). Service listens on `http://localhost:5080` in dev; Vite proxy maps `/api` → `http://localhost:5080` with `changeOrigin: true`. Set the port via `Properties/launchSettings.json` (`applicationUrl`) AND `appsettings.json` `Kestrel`/`Urls` so it is consistent when run via `dotnet run` without a profile.
- **JWT mode default: JWKS (asymmetric)** when `Supabase:JwtSecret` is absent; fall back to HS256 when the secret is configured. Issuer `${Supabase:Url}/auth/v1`, audience `authenticated`. Must BUILD and TEST with no live secret.
- **Frontend has NO test runner** (`package.json` scripts: `dev`, `build`, `preview` only). Frontend verification = `npm run build`.

## Three frontend call sites + proxy (exact)

1. **`src/pages/Cart.jsx`** — `placeOrder` currently a no-op TODO; the submit button is `disabled` with a "coming soon" placeholder `<p>`. Replace with `POST {base}/api/orders` body `{ vendorId, pickupName, note, items: lines.map(l => ({ menuItemId: l.item.id, qty: l.qty })) }` (ids + qty only, NEVER prices). On 201, `clearCart()` then `navigate('/order/' + resp.id)` (the returned UUID). Surface `422 ITEM_UNAVAILABLE` / `409 VENDOR_CLOSED` as friendly messages. Remove the placeholder `<p>` and the `disabled` attr; keep `disabled` only while the request is in flight or when `closed`.
2. **`src/pages/OrderStatus.jsx`** — the pending-state "Cancel order" button is `disabled` with a TODO. Wire it to prompt for a reason then `POST /api/orders/{order.uuid}/transition { to:'cancelled', reason }`; on success re-run the existing Supabase order fetch (refresh). Keep reading status via Supabase (already does). `order.uuid` (the real UUID) is already captured in state; use it, not `order.id` (= display code).
3. **`src/pages/Dashboard.jsx`** — `changeStatus(id, status)` and `reject(id, reason)` are UI-only optimistic TODOs. Wire both to `POST /api/orders/{uuid}/transition` with the right `to` (`preparing`/`ready`/`completed` for accept/ready/complete; `cancelled`+reason for reject), then refresh orders via the existing Supabase fetch. **Blocker to fix:** the orders list currently keys by `o.code` (display code) and the select does NOT fetch the UUID `id` — add `id` (UUID) to the `.select(...)` and carry it onto each order object (e.g. `uuid: o.id`) so the transition call has the real id. `OrdersTab` passes `o.id` to `onStatus`; change the data shape so the handler receives the UUID.
4. **`vite.config.js`** — add under the existing `server` block: `proxy: { '/api': { target: 'http://localhost:5080', changeOrigin: true } }`. Do not remove `port`/`open`.
5. **Fetch helper** — add `src/lib/api.js` with a helper that reads the access token via `supabase.auth.getSession()`, sets `Authorization: Bearer <token>`, `Content-Type: application/json`, uses `import.meta.env.VITE_API_BASE_URL || '/api'` as base, and throws a typed error carrying the parsed `{ code, ... }` body so call sites can branch on `ITEM_UNAVAILABLE` / `VENDOR_CLOSED` / `ILLEGAL_TRANSITION`.

## Ordered implementation items

- [ ] 1. Create the solution + API project skeleton under `server/`: `FoodHerons.sln`, `FoodHerons.Api/FoodHerons.Api.csproj` (`net10.0`, `Microsoft.NET.Sdk.Web`), with package refs `Microsoft.AspNetCore.Authentication.JwtBearer` and `Npgsql`. Add a minimal `Program.cs` (builder + `app.Run()`) so the project compiles.
      Files: `server/FoodHerons.sln`, `server/FoodHerons.Api/FoodHerons.Api.csproj`, `server/FoodHerons.Api/Program.cs`.
      Verify: `dotnet build server/FoodHerons.sln` succeeds.

- [ ] 2. Add config files (NON-secret only): `appsettings.json` with `Supabase:Url`, `Supabase:Issuer`, `Supabase:Audience`, empty `ConnectionStrings:Postgres` placeholder, and `Urls`/Kestrel set to `http://localhost:5080`; `appsettings.Development.json` with placeholders only; `Properties/launchSettings.json` using `applicationUrl=http://localhost:5080`. Add `server/FoodHerons.Api/.env.example` documenting the exact user-secrets/env keys (`ConnectionStrings__Postgres`, `Supabase__JwtSecret`, `Supabase__Url`, `Supabase__Issuer`, `Supabase__Audience`, optional `Supabase__ServiceRoleKey`). Update root `.gitignore` to add `server/**/bin/`, `server/**/obj/`, `server/**/.env` with `!server/FoodHerons.Api/.env.example` AFTER the `.env.*` line.
      Files: `server/FoodHerons.Api/appsettings.json`, `appsettings.Development.json`, `Properties/launchSettings.json`, `server/FoodHerons.Api/.env.example`, `.gitignore`.
      Verify: `dotnet build server/FoodHerons.sln` succeeds; `git status` shows `.env.example` tracked and no real `.env`/bin/obj staged.

- [ ] 3. Create DTOs in `Dtos/`: `PlaceOrderRequest { string VendorId, string PickupName, string? Note, LineItemDto[] Items }`, `LineItemDto { string MenuItemId, int Qty }` — **no price field anywhere** (the request type must be structurally incapable of accepting a price), `PlaceOrderResponse { Guid Id, string Code, string Status, decimal Subtotal, decimal Total, string VendorId, ResponseLine[] Items, DateTimeOffset PlacedAt }` with `ResponseLine { string MenuItemId, string Name, decimal UnitPrice, int Qty }`, `TransitionRequest { string To, string? Reason }`, `OrderDto { Guid Id, string Code, string Status, string VendorId, decimal Subtotal, decimal Total, timestamps... }`.
      Files: `server/FoodHerons.Api/Dtos/*.cs`.
      Verify: `dotnet build server/FoodHerons.sln` succeeds.

- [ ] 4. Implement the pure, DB-free domain logic in `Services/OrderService.cs` behind test-stubbable abstractions (the menu-price lookup and current-status read are inputs/interfaces, NOT direct Npgsql calls):
      (a) **total computation** — merge duplicate line ids (sum qty), look up each `(vendorId, menuItemId)` via the injected menu lookup, reject unknown/unavailable → typed error with code `ITEM_UNAVAILABLE`, compute `subtotal = total = Σ unit_price*qty` from DB prices (client never supplies price);
      (b) **Asia/Manila openness** — convert `DateTimeOffset.UtcNow` to UTC+8 (fixed offset, no DST — do NOT rely on a Windows tz database id), format `HH:mm`, compare to `hours_open`/`hours_close` with overnight-wrap: `open<=close ? now>=open && now<close : now>=open || now<close`; `'00:00'`/`'00:00'` ⇒ always closed;
      (c) **transition state machine** — legal set exactly: pending→preparing, preparing→ready, ready→completed, pending→cancelled, preparing→cancelled; everything else (backward/skip/terminal) → `ILLEGAL_TRANSITION`; classify each legal transition as vendor-action vs student-cancel for the authorization layer; student cancel legal only from `pending`.
      Also add input-validation helpers: pickupName trim 2–80, note ≤280, items 1–50, qty 1–99, reason required iff `to='cancelled'` and ≤140.
      Files: `server/FoodHerons.Api/Services/OrderService.cs` (+ small abstraction interfaces it depends on).
      Verify: `dotnet build server/FoodHerons.sln` succeeds.

- [ ] 5. Implement `Data/Db.cs` — an Npgsql connection factory reading `ConnectionStrings:Postgres`, plus the concrete DB-backed operations used by endpoints: menu lookup for a vendor (returns name/price/available per id), vendor existence + `preorder_enabled` + hours + `owner_id`, the single-transaction INSERT of `orders` (omit `code`, `RETURNING id, code, placed_at`) + `order_items`, and the transition txn (`SELECT status, student_id, vendor_id ... FOR UPDATE`, apply if legal, set matching lifecycle timestamp + `cancel_reason` on reject, `RETURNING` the row). This is the service-role connection (bypasses RLS). Keep SQL parameterized.
      Files: `server/FoodHerons.Api/Data/Db.cs`.
      Verify: `dotnet build server/FoodHerons.sln` succeeds (no live DB needed to compile).

- [ ] 6. Implement `Auth/SupabaseJwt.cs` — a DI extension configuring `JwtBearer`: JWKS mode (authority/metadata from `${Supabase:Url}/auth/v1`, JWKS at `/.well-known/jwks.json`) by default; HS256 mode (`SymmetricSecurityKey` from `Supabase:JwtSecret`) when that secret is present. Validate issuer `${Supabase:Url}/auth/v1`, audience `authenticated`, lifetime, signature. Map `sub`→user id, read `app_metadata.role`. Must configure without throwing when no secret is set (validation only fails at request time).
      Files: `server/FoodHerons.Api/Auth/SupabaseJwt.cs`.
      Verify: `dotnet build server/FoodHerons.sln` succeeds.

- [ ] 7. Implement `Endpoints/OrdersEndpoints.cs` + finalize `Program.cs`: Minimal API host wiring auth, CORS (allow the frontend origin as a backstop), DI (OrderService, Db, ILogger), and the `/api` route group requiring authentication. `POST /api/orders`: require role `student` (403 else), force `student_id`=caller uid, validate vendor exists + `preorder_enabled` + open-in-Manila (409 `VENDOR_CLOSED`), run price/total logic, INSERT in one txn, return 201 `PlaceOrderResponse`. `POST /api/orders/{id}/transition`: load order (404), authorize (vendor owner for vendor moves, student_id for student cancel; else 403), apply state machine atomically (409 `ILLEGAL_TRANSITION`; student cancel lost race → 409), 422 if cancel without reason, return 200 `OrderDto`. Error contract per §4: machine-readable `code` on 4xx; 5xx returns generic body + correlation id (never a stack trace); log via `ILogger` at stated levels with no PII beyond order code + user id. NO GET endpoint.
      Files: `server/FoodHerons.Api/Endpoints/OrdersEndpoints.cs`, `server/FoodHerons.Api/Program.cs`.
      Verify: `dotnet build server/FoodHerons.sln` succeeds.

- [ ] 8. Create the xUnit test project `server/FoodHerons.Api.Tests/` (`FoodHerons.Api.Tests.csproj` referencing the API project, `xunit`, `xunit.runner.visualstudio`, `Microsoft.NET.Test.Sdk`) and add tests against `OrderService` with stubbed menu-lookup/status inputs (NO live Postgres):
      - total computation: server price wins over any client attempt; the request DTO has no price field (compile-time guarantee — assert via the type/shape); duplicate line ids merge (summed qty); unknown item → `ITEM_UNAVAILABLE`; unavailable item → `ITEM_UNAVAILABLE`.
      - Asia/Manila openness: a normal window open/closed, and the overnight-wrap case (close < open spanning midnight) open/closed on both sides of midnight; `'00:00'/'00:00'` ⇒ closed.
      - transition state machine: every legal forward move allowed; each backward/skip/terminal move rejected; student-cancel allowed only while `pending`, rejected from `preparing`/`ready`/terminal.
      - input validation: pickupName <2 and >80 rejected, note >280 rejected, qty 0/100 rejected, empty items rejected, cancel without reason rejected.
      Files: `server/FoodHerons.Api.Tests/FoodHerons.Api.Tests.csproj`, `server/FoodHerons.Api.Tests/*Tests.cs`; add the test project to `FoodHerons.sln`.
      Verify: `dotnet test server/FoodHerons.sln` passes all tests.

- [ ] 9. Add the frontend fetch helper `src/lib/api.js` (reads token from `supabase.auth.getSession()`, sets `Authorization: Bearer`, base `import.meta.env.VITE_API_BASE_URL || '/api'`, throws a typed error exposing the parsed `{ code }`), and add the Vite dev proxy to `vite.config.js` (`server.proxy['/api'] = { target: 'http://localhost:5080', changeOrigin: true }`) without disturbing `port`/`open`.
      Files: `src/lib/api.js`, `vite.config.js`.
      Verify: `npm run build` succeeds.

- [ ] 10. Wire `src/pages/Cart.jsx` `placeOrder` to `POST /api/orders` via the helper (body: ids + qty only), clear cart and `navigate('/order/'+resp.id)` on 201, map `ITEM_UNAVAILABLE`/`VENDOR_CLOSED` to friendly inline messages; remove the "coming soon" placeholder and unconditional `disabled`.
      Files: `src/pages/Cart.jsx`.
      Verify: `npm run build` succeeds.

- [ ] 11. Wire `src/pages/OrderStatus.jsx` pending-state Cancel button to prompt a reason then `POST /api/orders/{order.uuid}/transition { to:'cancelled', reason }`, refresh via the existing Supabase fetch on success; keep reading status via Supabase; un-disable the button.
      Files: `src/pages/OrderStatus.jsx`.
      Verify: `npm run build` succeeds.

- [ ] 12. Wire `src/pages/Dashboard.jsx`: add the order UUID to the orders `.select('id, code, ...')` and carry it (`uuid: o.id`) onto each order object; change `changeStatus`/`reject` to call `POST /api/orders/{uuid}/transition` (accept→preparing, ready→ready, complete→completed; reject→cancelled+reason) and refresh orders from Supabase afterward instead of the optimistic-only mutation. Ensure `OrdersTab`/`onStatus`/`onReject` pass the UUID, not the display code.
      Files: `src/pages/Dashboard.jsx`.
      Verify: `npm run build` succeeds.

- [ ] 13. Final verification sweep.
      Verify:
      - `dotnet build server/FoodHerons.sln` — succeeds.
      - `dotnet test server/FoodHerons.sln` — all tests pass.
      - `npm run build` — succeeds (frontend has no test runner).
      - Secret-leak grep: search `server/` tracked files and `.env.example` for any real connection string / JWT secret / service-role key; confirm placeholders only. Confirm `git status` shows no `.env`, no `bin/`, no `obj/` staged.
      - Confirm no client-side direct write to `orders`/`order_items` was introduced (grep `from('orders').insert` / `.update(` on orders in `src/`): only reads remain; writes go through the service.

## Notes / assumptions (needs-verification-during-implementation)

- The design says the service "the user sees something we don't": even where a file looks already wired (e.g. Dashboard already reads orders from Supabase), the coder must still verify the UUID-vs-code gap in item 12 is fixed, because the transition endpoint needs the UUID and the current select omits it.
- JWT signing mode is user-confirmed at runtime (Open Q6). Ship JWKS-default + HS256-fallback behind config; document both keys in `.env.example`. Do not hardcode a project ref.
- CORS origin for prod is unknown; configure a dev origin (`http://localhost:5173`) and read allowed origins from config so prod can override. The Vite proxy makes dev same-origin regardless.
- Money is `numeric(10,2)` → use `decimal` in C# end to end; never `double`/`float`.
