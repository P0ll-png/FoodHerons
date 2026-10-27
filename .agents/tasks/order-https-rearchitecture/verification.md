# Verification — Order-service HTTPS re-architecture

All commands below were actually run on Windows / PowerShell against the live
Supabase project `fozwmscvuzsrmwzortrr`. Results are recorded verbatim-in-substance.

## 1. Build — PASS (0 errors)

```
dotnet build c:\Users\paulc\Projects\FoodHerons\server\FoodHerons.sln
```

Result: `Build succeeded. 0 Error(s)`.

Confirmed after the data-layer rewrite, the Program.cs DI/fail-fast swap, the
appsettings edit, and the `Npgsql` PackageReference removal. A residual
`using Npgsql;` anywhere would have failed the build (the package is gone);
it compiled clean, so no Npgsql code path survives in the request path.

## 2. Tests — PASS (78/78)

```
dotnet test c:\Users\paulc\Projects\FoodHerons\server\FoodHerons.Api.Tests\FoodHerons.Api.Tests.csproj
```

Result: `Passed! - Failed: 0, Passed: 78, Skipped: 0, Total: 78`.

- 61 pre-existing tests still pass (the 4 pure `OrderService*` classes are untouched).
- `OrderServiceEndpointFaultTests` now injects a `ThrowingHandler` on the **typed**
  `Db` client (`services.AddHttpClient<Db>().ConfigurePrimaryHttpMessageHandler(...)`)
  — deterministic, zero network — and still asserts the clean 500 (`code=INTERNAL`,
  non-blank `correlationId`, no `Npgsql`/`StackTrace`/`   at ` leak).
- New `DbSupabaseTests` (stub `HttpMessageHandler`) cover: GET URL/header shape,
  `[]`→null, null owner_id, the `in.(...)` filter + **absent-id-omitted** invariant,
  empty-input short-circuit (no HTTP call), `place_order` POST body + single-object
  deserialize (no array unwrap), status read, transition success, and the
  FH001→ILLEGAL_TRANSITION / FH002→NOT_FOUND mapping **keyed off the body `code`
  regardless of HTTP status** (incl. an FH001 under a 500), unknown-code/unparseable
  →throw, and the no-leak invariant (Supabase body string absent from the exception).
- Legal-set sync test asserts the 5 SQL whitelist pairs all pass `OrderService` and
  representative illegal pairs are rejected by both — pins SQL↔C# in sync.

## 3. Live HTTPS transport — PROVEN reachable

PostgREST is live over 443 with the service-role key. The RPC functions do **not**
exist yet (expected — migration not applied):

```
POST https://fozwmscvuzsrmwzortrr.supabase.co/rest/v1/rpc/place_order
-> HTTP 404 {"code":"PGRST202", ... "Could not find the function public.place_order ..."}
```

No HTTPS arbitrary-SQL channel exists on this project (confirmed by probing
`rpc/exec_sql`, `rpc/exec`, `rpc/query` — all 404) and no `supabase`/`psql` CLI is
installed locally (only Node). Per `supabase/README.md`, migrations are applied via
the dashboard SQL editor. **Applying `0007` is therefore the one remaining manual step.**

## 4. End-to-end live order over HTTPS — PROVEN up to the (missing) RPC

Config supplied via `dotnet user-secrets` (`Supabase:Url`, `Supabase:ServiceRoleKey`,
`Supabase:Issuer`). API started with `ASPNETCORE_ENVIRONMENT=Development` on
`http://localhost:5099` (5080 avoided; overrode `Kestrel__Endpoints__Http__Url`/`Urls`).

- `GET /health` -> `200 {"status":"ok"}`.
- Minted a student JWT: `POST .../auth/v1/token?grant_type=password`
  (apikey = anon key, body = test-student-2132563208@foodherons.local / TestStudent!2026)
  -> **access_token obtained** (length 907).
- `POST http://localhost:5099/api/orders` with `Authorization: Bearer <jwt>` and body
  `{"vendorId":"tita-nenas","pickupName":"Test","note":null,"items":[{"menuItemId":"tapsilog","qty":1}]}`:
  - First attempt -> **HTTP 409 `VENDOR_CLOSED`** (NOT 500). This already proves the full
    HTTPS path works: JWT validated, `GetVendorAsync` fetched the real vendor row over
    PostgREST, and the endpoint correctly evaluated openness. The vendor `tita-nenas` is
    `preorder_enabled=true` with hours 06:30–15:00 PH and it was 02:02 PH — genuinely closed.
  - To reach the write path I temporarily PATCHed the vendor hours to 00:00–23:59 over
    PostgREST, retried, then restored them to 06:30–15:00. With the vendor open the retry
    returned **HTTP 500 `INTERNAL`** with a `correlationId` and **no leaked body/stack** —
    because the request reached `POST rpc/place_order` and the function does not exist yet
    (PGRST202). This is the expected outcome until the migration is applied.
  - Vendor hours verified restored to `06:30-15:00` afterward.

No throwaway orders were created (the insert never committed — the RPC is absent), so
there was nothing to clean up.

**Conclusion:** the transport, auth, config, reads, pricing, openness, and the clean-500
contract are all verified live over HTTPS 443. The only thing standing between the current
500 and a 201 is applying `0007_order_rpcs.sql`. After that single manual step the same
`POST /api/orders` returns 201 with an order `id`/`code`.

## 5. Remaining manual step (copy-paste)

Open the Supabase dashboard for project `fozwmscvuzsrmwzortrr`
(https://fozwmscvuzsrmwzortrr.supabase.co) -> SQL editor -> paste the entire contents of
`supabase/migrations/0007_order_rpcs.sql` -> Run.

Verify the functions exist (dashboard SQL editor):

```sql
select proname from pg_proc where proname in ('place_order','transition_order');
```

Expect both rows. Or verify over HTTPS that PostgREST now resolves `place_order`
(a well-formed call that no longer returns PGRST202):

```
POST https://fozwmscvuzsrmwzortrr.supabase.co/rest/v1/rpc/place_order
headers: apikey:<service-role>, Authorization: Bearer <service-role>, Content-Type: application/json
body: {"p_student":"<uuid>","p_vendor":"tita-nenas","p_subtotal":42.00,"p_total":42.00,"p_pickup":"Test","p_note":null,"p_items":[{"menu_item_id":"tapsilog","vendor_id":"tita-nenas","name":"Tapsilog","unit_price":42.00,"qty":1}]}
```

Then re-run the end-to-end order (vendor must be open, i.e. within 06:30–15:00 PH or
temporarily widen hours) and expect **HTTP 201** with an order `id` + `code`.
