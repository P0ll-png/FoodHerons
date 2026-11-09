# Design Review — order-service HTTPS re-architecture (finalization pass)

**Scope:** Confirm the 8 specific corrections are baked into
`.agents/tasks/order-https-rearchitecture/design.md`, and catch any NEW ambiguity,
gap, or unverified assumption the corrections introduced. The already-approved core
architecture (PostgREST GET reads; two `SECURITY DEFINER` RPCs for atomic writes; typed
`AddHttpClient<Db>`; Npgsql removal; `IOrderData`/`Db` seam; error-code contract) was NOT
re-litigated.

**Method:** Read the full design, then verified every factual claim against the real
source and schema: `Db.cs`, `Program.cs`, `appsettings.json`, `OrdersEndpoints.cs`,
`OrderService.cs`, `OrderServiceEndpointFaultTests.cs`, `FoodHerons.Api.csproj`, and
migrations `0002_enums.sql`, `0003_tables.sql`, `0004_functions_triggers.sql`. The target
source (`Db.cs` etc.) still holds the Npgsql implementation, which is expected — the design
is the artifact under review, not the yet-to-be-written code.

---

## Confirmation of the 8 required corrections

1. **Fault test uses `ConfigurePrimaryHttpMessageHandler` on the TYPED `Db` client with a
   `ThrowingHandler` (zero network); old "empty URL => null BaseAddress" explanation gone;
   still asserts clean 500.** — PRESENT & CORRECT. "DI / config / startup changes" item 2 and
   the "Test strategy" regression-guard paragraph both specify
   `services.AddHttpClient<Db>().ConfigurePrimaryHttpMessageHandler(() => new ThrowingHandler())`
   inside `FaultWebAppFactory.ConfigureTestServices`, with `ThrowingHandler.SendAsync` throwing
   `HttpRequestException("fault-test")`. The old null-`BaseAddress`-under-Testing explanation is
   explicitly deleted (Finding 1 correction block). The existing test's assertions
   (`InternalServerError`, `code=INTERNAL`, non-blank `correlationId`, no `Npgsql`/`StackTrace`/
   `   at ` leak) are preserved and match
   `OrderServiceEndpointFaultTests.Place_order_db_fault_returns_clean_500_problem_details`.

2. **`AddHttpClient<Db>` guards config with no `!` assertions.** — PRESENT & CORRECT. The snippet
   reads `Supabase:Url`/`Supabase:ServiceRoleKey` with no `!`, sets `BaseAddress` only under
   `!string.IsNullOrWhiteSpace(baseUrl)`, and adds `apikey` + `Authorization: Bearer` only under
   `!string.IsNullOrWhiteSpace(key)`. The prose states absent/empty config must not throw at
   registration; a request against a null-`BaseAddress` client throws at send time and the
   endpoint `try/catch` turns it into the clean 500.

3. **Data layer returns null for a missing vendor and NEVER emits `VENDOR_CLOSED`; endpoint
   decides `VENDOR_CLOSED` (place path) vs `FORBIDDEN` (transition owner check).** — PRESENT &
   CORRECT, and verified against `OrdersEndpoints.cs`: `PlaceOrderAsync` maps
   `vendor is null || !PreorderEnabled || !IsOpenNow(...)` to a 409 `ErrorCodes.VendorClosed`;
   `IsVendorOwnerAsync` returns `vendor?.OwnerId == userId` and a false result routes to the 403
   `FORBIDDEN` branch. The error table's `GetVendorAsync` empty-array row now reads exactly this.

4. **RPC responses deserialize directly into `OrderRow` as a single JSON object; no array
   unwrap; no dependence on `Prefer: return=representation`.** — PRESENT & CORRECT. The
   definitive note after the `place_order` sketch and the `transition_order` description both
   state `RETURNS public.orders` is a single composite row serialized as a single JSON object,
   deserialized with no `[0]` indexing, and the `Prefer` line was removed. This is factually
   right: both functions declare scalar `returns public.orders` (not `SETOF`/`TABLE`), which
   PostgREST emits as one object.

5. **Test strategy explicitly targets the TYPED client, not a named "supabase" client.** —
   PRESENT & CORRECT. Both the registration notes and the Test-strategy section mandate the
   typed overload `AddHttpClient<Db>()` for the handler override and explicitly warn that a
   named `AddHttpClient("supabase")` override builds a different, unused client that never
   reaches the `Db` instance.

6. **`ApplyTransitionAsync` keys FH001/FH002 off the body `code` field regardless of HTTP
   status (status only 2xx-vs-not).** — PRESENT & CORRECT. The "How the SQLSTATE reaches C#"
   prose states the mapping keys off the response-body `code` field, treats status only as
   2xx-vs-non-2xx, maps `FH001 => ILLEGAL_TRANSITION` / `FH002 => NOT_FOUND`, and treats any
   other/unparseable non-2xx as fatal → `INTERNAL`. The Test-strategy case adds a non-400 error
   status assertion to pin this.

7. **`0007_order_rpcs.sql` guards the revoke against missing anon/authenticated roles.** —
   PRESENT & CORRECT. Both functions use an unconditional `revoke all ... from public` plus a
   `do $$ begin if exists (select from pg_roles where rolname in ('anon','authenticated')) then
   revoke ... end if; end $$;` guard. This matches the `do $$ ... $$` idiom already used in
   `0002_enums.sql` and the `SECURITY DEFINER / set search_path = public` style of
   `0004_functions_triggers.sql`.

8. **Stale XML-doc comments in `Db.cs` and `OrderServiceEndpointFaultTests` are updated.** —
   PRESENT & CORRECT as a directive. "Files to change" calls for rewriting the `Db.cs` class
   summary (drop "The Npgsql-backed data layer… All SQL is parameterized") and the
   `OrderServiceEndpointFaultTests` test-class + `FaultWebAppFactory` summaries (drop "empty
   connection string and throws") to describe the Supabase HTTPS/PostgREST/RPC transport and the
   throwing-handler fault injection. The current stale text was confirmed present in both files,
   so the directive targets the right strings.

All 8 corrections are present, internally consistent, and grounded in the real source/schema.

---

## Findings

No HIGH or MEDIUM findings. The items below are NITs (do not affect the verdict) and are
recorded so the implementer sees them.

1. **NIT — `using FoodHerons.Api.Data;` is required in the fault-test file but not called out.**
   The current `OrderServiceEndpointFaultTests.cs` does not import `FoodHerons.Api.Data`, so the
   new `services.AddHttpClient<Db>()...` override and the `ThrowingHandler` cannot compile until
   that using is added. Where: "Test strategy" / "Files to change" (the `OrderServiceEndpointFaultTests.cs`
   modification bullet). Concrete fix: add a sentence to the Files-to-change bullet — "add
   `using FoodHerons.Api.Data;` (for `Db`) and `using System.Net.Http;` to the test file." Purely
   mechanical; the design's intent is unambiguous.

2. **NIT — the RPC item array carries a redundant per-item `vendor_id` that the design never
   reconciles with the single-vendor invariant.** The `place_order` JSON body nests
   `vendor_id` inside each `p_items` element, and the SQL inserts `elem->>'vendor_id'` into
   `order_items.vendor_id`. Every line always shares the one order-level `p_vendor` (verified:
   `OrdersEndpoints.PlaceOrderAsync` builds each `OrderItemInput` with the same `vendorId`), so
   the per-item value is always equal to `p_vendor`. This is harmless and matches today's
   `order_items.vendor_id` column (which has no FK, per `0003_tables.sql`), but the design does
   not state the invariant. Where: "Writes via RPC" `place_order` body. Concrete fix: add a
   one-line note — "each item's `vendor_id` always equals `p_vendor` (single-vendor order); the
   RPC does not cross-check them, matching the current unconstrained `order_items.vendor_id`
   column." Optional hardening, not a correctness gap.

---

## Verified Assumptions

- **Schema shape the RPCs depend on** (`0003_tables.sql`): `orders` has `student_id uuid`,
  `vendor_id text`, `subtotal`/`total numeric(10,2)`, `pickup_name text`, `note text` (nullable),
  `cancel_reason text`, `code` with sequence default `FH-NNNNNN`, `placed_at` default `now()`,
  and nullable `accepted_at`/`ready_at`/`completed_at`/`cancelled_at`; `order_items` has
  `(order_id, menu_item_id, vendor_id, name, unit_price, qty)` with `qty > 0` check and no FK to
  `menu_items`. The `place_order` insert columns and the `OrderRow` projection match exactly.
- **`RETURNS public.orders` => single JSON object** — correct: both functions return the scalar
  composite type, not `SETOF`/`TABLE`, so PostgREST serializes one object (Finding 4 claim holds).
- **`order_status` enum values** (`0002_enums.sql`): `pending, preparing, ready, completed,
  cancelled` — exactly the labels used in the SQL whitelist and the timestamp `case` arms.
- **SQL whitelist is a faithful mirror of `OrderService.Legal`** (`OrderService.cs`): both contain
  the identical 5 pairs `(pending→preparing)`, `(preparing→ready)`, `(ready→completed)`,
  `(pending→cancelled)`, `(preparing→cancelled)`. The legal-set sync test is justified.
- **Endpoint decides `VENDOR_CLOSED` vs `FORBIDDEN`** (`OrdersEndpoints.cs`): confirmed as
  described in Finding 3.
- **Endpoint `try/catch` → clean 500 `INTERNAL` + `correlationId`** (`OrdersEndpoints.ServerError`
  and the `Program.cs` `UseExceptionHandler`): both emit `code=INTERNAL` and a `correlationId`;
  the global handler logs with `LogError` and does not leak the exception. Supports the data
  layer's "throw → INTERNAL" mapping and the fault test's assertions.
- **Migration numbering/style** (`0004`, `0002`): `SECURITY DEFINER` + `set search_path = public`
  and the `do $$ begin if exists (...) then ... end if; end $$;` guard idiom are already in use,
  so `0007`'s style is consistent.
- **Stale XML-doc strings exist** in `Db.cs` ("The Npgsql-backed data layer… All SQL is
  parameterized") and `OrderServiceEndpointFaultTests.cs` ("reaches the first DB call
  (GetVendorAsync) with an empty connection string and throws") — Finding 8's target text is real.
- **`Npgsql` PackageReference exists** in `FoodHerons.Api.csproj` (`Version="10.0.3"`) — the
  removal directive targets a real reference.
- **`appsettings.json` ships a non-empty `Supabase:Url` placeholder**
  (`https://YOUR-PROJECT-REF.supabase.co`) and currently has NO `ServiceRoleKey` key and a
  `ConnectionStrings:Postgres: ""` — exactly the premise behind the Finding 1 correction and the
  item-3 appsettings edits.

## Unverified / Wrong Assumptions

- **PostgREST surfaces a raised SQLSTATE in the JSON `code` field** — plausible and the design
  explicitly treats it as version/proxy-dependent, keying off the body `code` and treating
  everything else as fatal, so the design does not actually *depend* on a specific status or
  wire shape. Not independently reproducible in a design review (no live PostgREST), but the
  design's handling is defensive and self-consistent. Not a finding.
- **The two RPCs do not yet exist in the repo** (`supabase/migrations/` stops at `0006_seed.sql`)
  and `Db.cs`/`Program.cs`/the csproj still carry the Npgsql implementation. This is expected for
  a design doc; no claim in the design contradicts the current tree. Not a finding.

---

## Verdict

All 8 required corrections are present and correct, and no new HIGH or MEDIUM finding was
introduced. Two NITs recorded (do not affect the gate).

**APPROVED** (0 HIGH, 0 MEDIUM, 2 NIT).
