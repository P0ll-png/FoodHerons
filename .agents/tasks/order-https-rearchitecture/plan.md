# Implementation Plan — Order-service HTTPS re-architecture (Supabase 443)

Source of truth: `.agents/tasks/order-https-rearchitecture/design.md` (approved;
`design-review.md` = APPROVED, all 8 corrections baked in). This plan sequences that design
against the real codebase; it does not re-decide the architecture.

Ground facts confirmed by reading the repo:

- `Db` is a `sealed class(NpgsqlDataSource)` in `server/FoodHerons.Api/Data/Db.cs` with 5 public
  methods (`GetVendorAsync`, `GetMenuItemsAsync`, `InsertOrderAsync`, `GetOrderStateAsync`,
  `ApplyTransitionAsync`) plus the 4 records (`VendorInfo`, `OrderState`, `OrderRow`,
  `OrderItemInput`). `MenuItemInfo`, `OrderStatuses`, `ErrorCodes`, `Result<T>`, `DomainError`
  live in `Services/OrderDomain.cs` / `OrderService.cs` — unchanged.
- `OrdersEndpoints.cs` injects `Db` by concrete type and wraps every data call in
  `try/catch -> ServerError` (clean 500 `INTERNAL` + `correlationId`); it owns the
  `VENDOR_CLOSED` (place path) and `FORBIDDEN` (owner-check path) decisions. **Not modified.**
- `Program.cs` registers `NpgsqlDataSource` + `AddSingleton<Db>()`, fails fast on empty
  `ConnectionStrings:Postgres` (skipped under `Testing`), and installs the global
  `UseExceptionHandler` clean-500. `using Npgsql;` at top.
- `appsettings.json` ships `Supabase:Url = "https://YOUR-PROJECT-REF.supabase.co"` (non-empty
  placeholder), `Supabase:Issuer/Audience`, and `ConnectionStrings:Postgres = ""`. No
  `Supabase:ServiceRoleKey` key yet.
- `FoodHerons.Api.csproj` has `<PackageReference Include="Npgsql" Version="10.0.3" />`.
- `0003_tables.sql` confirms `orders`/`order_items` columns exactly as the RPC SQL assumes;
  `0002_enums.sql` confirms `order_status` labels; `0004_functions_triggers.sql` confirms the
  `SECURITY DEFINER / set search_path = public` + `do $$ ... if exists ... $$` style.
- Migrations are applied manually via the Supabase dashboard SQL editor (per
  `supabase/README.md`); there is **no** HTTPS SQL-execution channel in repo tooling (the seed
  script uses the JS SDK for data ops, not arbitrary SQL). Live project URL
  `https://fozwmscvuzsrmwzortrr.supabase.co`; service-role key is in
  `supabase/scripts/.env` as `SUPABASE_SERVICE_ROLE_KEY`.
- Baseline `dotnet build server/FoodHerons.sln` = 0 warnings / 0 errors (verified green).

Build/test commands used for verification throughout:
- Build: `dotnet build c:\Users\paulc\Projects\FoodHerons\server\FoodHerons.sln`
- Test: `dotnet test c:\Users\paulc\Projects\FoodHerons\server\FoodHerons.Api.Tests\FoodHerons.Api.Tests.csproj`

Order rationale: the SQL migration (item 1) is independent and goes first. Then the data layer
rewrite (item 2) — but `Db`'s constructor change from `NpgsqlDataSource` to `HttpClient` will
break the build until `Program.cs` DI is updated, so items 2+3+4 land together as the first
buildable checkpoint. Config/appsettings (item 5) and the csproj Npgsql removal (item 6) follow.
Then the two test changes (items 7, 8). Each item states its own buildable/verifiable boundary.

---

- [ ] 1. Author the new migration `supabase/migrations/0007_order_rpcs.sql` with the two
      `SECURITY DEFINER` RPCs `public.place_order(p_student uuid, p_vendor text, p_subtotal
      numeric, p_total numeric, p_pickup text, p_note text, p_items jsonb) returns public.orders`
      and `public.transition_order(p_id uuid, p_to text, p_reason text) returns public.orders`,
      copied verbatim from the design's §"Migration SQL" code block (including the header
      comment, `set search_path = public`, the `jsonb_array_elements(p_items)` item insert, the
      5-pair whitelist mirror of `OrderService.Legal`, the `raise ... using errcode = 'FH001'`
      illegal / `'FH002'` not-found exceptions, and BOTH guarded lockdowns: unconditional
      `revoke all ... from public` plus the `do $$ begin if exists (select from pg_roles where
      rolname in ('anon','authenticated')) then revoke ... end if; end $$;` guard — Finding 7).
      This file is not compiled by C#; it is verified by application (item 11).
      Files: `supabase/migrations/0007_order_rpcs.sql`
      Verify: `dotnet build c:\Users\paulc\Projects\FoodHerons\server\FoodHerons.sln` still 0
      errors (SQL file does not affect the build; confirms nothing else broke). Final SQL
      validity is proven when item 11 applies it to the live project without error.

- [ ] 2. Rewrite `server/FoodHerons.Api/Data/Db.cs` onto `HttpClient`, keeping the type name
      `Db`, the namespace `FoodHerons.Api.Data`, the 5 public method signatures, and the 4
      records unchanged. Change the constructor to `public sealed class Db(HttpClient http)`;
      remove `using Npgsql;`; add `using System.Net.Http.Json;` / `using System.Text.Json;` /
      `using System.Text.Json.Serialization;` as needed. Implement per the design:
      - `GetVendorAsync`: `GET vendors?id=eq.{Uri.EscapeDataString(vendorId)}&select=id,owner_id,preorder_enabled,hours_open,hours_close&limit=1`;
        parse the JSON array; `[]` -> `null`; map first element -> `VendorInfo` (`owner_id` JSON
        null -> `Guid?` null). Non-2xx / network / malformed JSON -> throw (sanitized, no body).
        Never emits `VENDOR_CLOSED` (Finding 3).
      - `GetMenuItemsAsync`: keep the `Distinct(StringComparer.Ordinal)` + empty-input
        short-circuit (empty set -> no HTTP call, empty map); build
        `GET menu_items?vendor_id=eq.{esc}&id=in.({"id1","id2"})&select=id,name,price,available`
        with each id wrapped in double quotes and embedded `"`/`\` backslash-escaped, each id
        `Uri.EscapeDataString`-d; project array into `Dictionary<string, MenuItemInfo>` keyed by
        id; absent ids stay absent from the map.
      - `InsertOrderAsync`: `POST rpc/place_order` with JSON body
        `{p_student, p_vendor, p_subtotal, p_total, p_pickup, p_note, p_items:[{menu_item_id,
        vendor_id, name, unit_price, qty}...]}`; do NOT send `Prefer: return=representation`;
        deserialize the single JSON object directly into `OrderRow` (no `[0]` unwrap — Finding 4).
        Non-2xx / network / malformed -> throw.
      - `GetOrderStateAsync`: `GET orders?id=eq.{id}&select=id,status,student_id,vendor_id&limit=1`;
        status comes back as its text label (no `::text`); `[]` -> `null`.
      - `ApplyTransitionAsync`: drop the old `OrderService` re-plan; `POST rpc/transition_order`
        with `{p_id, p_to, p_reason}`. On 2xx: deserialize the single JSON object -> `OrderRow`,
        return `Result.Ok`. On non-2xx: read the body, extract the `code` field REGARDLESS of HTTP
        status (status only 2xx-vs-not — Finding 6); `FH001` -> `Result.Fail(ILLEGAL_TRANSITION
        409)`, `FH002` -> `Result.Fail(NOT_FOUND 404)`; any other/unparseable -> throw. The
        `orderService` parameter stays in the signature (endpoint passes it) but is no longer used
        for planning.
      Add private JSON DTO records for the PostgREST payloads (vendor row, menu row, order row,
      place_order item, error body `{code,...}`) with `[JsonPropertyName]` snake_case mapping;
      `numeric(10,2)` -> `decimal`. Request paths are RELATIVE without a leading slash so the
      `/rest/v1/` `BaseAddress` segment is retained. **Rewrite the class XML-doc summary** (drop
      "The Npgsql-backed data layer... All SQL is parameterized") to describe the Supabase HTTPS
      transport: typed `HttpClient` against `${Supabase:Url}/rest/v1/`, PostgREST GET reads,
      `place_order`/`transition_order` RPC writes (Finding 8). Reuse the existing `Result<T>` /
      `DomainError` / `ErrorCodes` from `Services`.
      Files: `server/FoodHerons.Api/Data/Db.cs`
      Verify: build in item 4 (this item leaves the tree non-building until Program.cs is updated —
      the ctor change is a breaking change, so items 2+3+4 are one checkpoint).

- [ ] 3. Update `server/FoodHerons.Api/Program.cs` DI. Remove `using Npgsql;`, the
      `AddSingleton(sp => new NpgsqlDataSourceBuilder(...).Build())` registration, and the
      `AddSingleton<Db>()` line. Add the typed client exactly as the design's §"HttpClient
      registration" snippet: `builder.Services.AddHttpClient<Db>(client => { ... })` reading
      `Supabase:Url` and `Supabase:ServiceRoleKey` with NO `!` assertions — set `BaseAddress =
      new Uri($"{baseUrl.TrimEnd('/')}/rest/v1/")` only when the URL is non-empty, and add the
      `apikey` header + `Authorization: Bearer <key>` only when the key is non-empty. Registration
      must never throw for absent/empty config (Finding 2). Use the TYPED overload
      `AddHttpClient<Db>` (Finding 5) — this also registers `Db`, replacing the old
      `AddSingleton<Db>()`.
      Files: `server/FoodHerons.Api/Program.cs`
      Verify: build in item 4.

- [ ] 4. Replace the Postgres fail-fast in `Program.cs` with the Supabase fail-fast from the
      design's §"DI / config / startup changes" item 2: read `Supabase:Url` +
      `Supabase:ServiceRoleKey`; `if ((IsNullOrWhiteSpace(url) || IsNullOrWhiteSpace(key)) &&
      !builder.Environment.IsEnvironment("Testing")) throw new InvalidOperationException(...)`
      with the design's message. The `Testing` gate keeps `WebApplicationFactory` booting.
      Files: `server/FoodHerons.Api/Program.cs`
      Verify: `dotnet build c:\Users\paulc\Projects\FoodHerons\server\FoodHerons.sln` — 0 errors
      (first buildable checkpoint after the data-layer rewrite; items 2+3+4 now compile together).

- [ ] 5. Update `server/FoodHerons.Api/appsettings.json`: add `"ServiceRoleKey": ""` under the
      existing `Supabase` section (placeholder only — the real key lives in user-secrets /
      `Supabase__ServiceRoleKey` env, never committed), and remove the now-unused
      `ConnectionStrings` block (nothing reads `Postgres` on the request path after items 3/4).
      Leave `Supabase:Url/Issuer/Audience` and the rest untouched.
      Files: `server/FoodHerons.Api/appsettings.json`
      Verify: `dotnet build c:\Users\paulc\Projects\FoodHerons\server\FoodHerons.sln` — 0 errors
      (valid JSON; no code references the removed key).

- [ ] 6. Remove the `<PackageReference Include="Npgsql" Version="10.0.3" />` line from
      `server/FoodHerons.Api/FoodHerons.Api.csproj`. After item 2 no code references Npgsql, so
      the reference is dead; removing it guarantees no Postgres-socket path survives.
      Files: `server/FoodHerons.Api/FoodHerons.Api.csproj`
      Verify: `dotnet build c:\Users\paulc\Projects\FoodHerons\server\FoodHerons.sln` — 0 errors
      (a residual `using Npgsql;` anywhere would now fail the build, confirming full removal).

- [ ] 7. Make `OrderServiceEndpointFaultTests.cs` deterministic and network-free. Add a
      `ThrowingHandler : HttpMessageHandler` whose `SendAsync` throws
      `new HttpRequestException("fault-test")`. In `FaultWebAppFactory.ConfigureTestServices`,
      register it on the TYPED client:
      `services.AddHttpClient<Db>().ConfigurePrimaryHttpMessageHandler(() => new ThrowingHandler());`
      (typed overload only — a named `AddHttpClient("supabase")` would build a different, unused
      client; Finding 5). Add `using FoodHerons.Api.Data;` (for `Db`) and `using System.Net.Http;`
      to the file (NIT 1). Rewrite the stale test-class XML-doc summary AND the `FaultWebAppFactory`
      summary (both currently say the request "reaches the first DB call (GetVendorAsync) with an
      empty connection string and throws") to describe the Supabase HTTPS/PostgREST/RPC transport
      and the throwing-handler fault injection — no Npgsql, no connection string (Finding 8). The
      test's response-only assertions (`InternalServerError`, `code=INTERNAL`, non-blank
      `correlationId`, no `Npgsql`/`StackTrace`/`   at ` leak) stay exactly as-is.
      Files: `server/FoodHerons.Api.Tests/OrderServiceEndpointFaultTests.cs`
      Verify: `dotnet test ...FoodHerons.Api.Tests.csproj --filter
      FullyQualifiedName~OrderServiceEndpointFaultTests` — the fault test passes with zero network
      (fast, no DNS attempt).

- [ ] 8. Add `server/FoodHerons.Api.Tests/DbSupabaseTests.cs` — mock-`HttpMessageHandler` unit
      tests for the rewritten `Db`. Add a `StubHttpMessageHandler` that records the outgoing
      `HttpRequestMessage` (method, URI, headers, body) and returns a canned
      `HttpResponseMessage`; construct `Db` with
      `new HttpClient(stub) { BaseAddress = new Uri("https://x.test/rest/v1/") }`. Cover, per the
      design's §"Test strategy":
      - `GetVendorAsync` builds the expected `vendors?id=eq...&select=...` relative URL, sends
        `apikey`/`Bearer` headers, parses a 1-element array -> `VendorInfo`, and returns `null` for
        `[]`.
      - `GetMenuItemsAsync` builds the `in.(...)` filter, maps present ids, OMITS absent ids
        (unavailable-semantics invariant), and short-circuits empty input (no HTTP call, empty map).
      - `InsertOrderAsync` POSTs `rpc/place_order` with the correct JSON argument names + item
        array and deserializes the returned single order OBJECT -> `OrderRow` (code + placed_at
        populated; no array unwrap).
      - `GetOrderStateAsync` parses the status read; `[]` -> `null`.
      - `ApplyTransitionAsync`: 2xx -> `Result.Ok`; body `{"code":"FH001",...}` -> `Result.Fail`
        `ILLEGAL_TRANSITION`; `{"code":"FH002",...}` -> `NOT_FOUND`; INCLUDE a case asserting the
        same `FH001`->`ILLEGAL_TRANSITION` mapping under a NON-400 error status (pins Finding 6:
        keyed off body `code`, not HTTP status); an unparseable body / a non-2xx body whose `code`
        is neither `FH001` nor `FH002` -> `Assert.ThrowsAsync`.
      - A non-2xx on a read/insert throws AND the Supabase response body string is absent from the
        exception message (no-leak invariant).
      Files: `server/FoodHerons.Api.Tests/DbSupabaseTests.cs`
      Verify: `dotnet test ...FoodHerons.Api.Tests.csproj --filter
      FullyQualifiedName~DbSupabaseTests` — all new cases pass.

- [ ] 9. Add the legal-set sync test (new case in `DbSupabaseTests.cs` or a small
      `TransitionLegalSetSyncTests.cs`). Encode the `0007` SQL whitelist as a constant list of 5
      `(from,to)` pairs copied from the migration and assert it equals the projection of the C#
      legal set (the 5 pairs in `OrderService` — exposed for the test, e.g. reflected or mirrored
      as a constant in the test from the known 5 pairs: pending->preparing, preparing->ready,
      ready->completed, pending->cancelled, preparing->cancelled). A mismatch fails the build,
      preventing silent drift between SQL and C#. No live DB needed.
      Files: `server/FoodHerons.Api.Tests/DbSupabaseTests.cs` (or a new sync-test file)
      Verify: `dotnet test ...FoodHerons.Api.Tests.csproj --filter FullyQualifiedName~Legal` —
      the sync assertion passes.

- [ ] 10. Full regression gate. Run the whole suite and confirm all pre-existing 61 tests plus the
      new `DbSupabaseTests` + legal-set sync test are green, and the four pure `OrderService*`
      test classes are unaffected.
      Files: none (verification only)
      Verify: `dotnet build c:\Users\paulc\Projects\FoodHerons\server\FoodHerons.sln` (0 errors)
      then `dotnet test c:\Users\paulc\Projects\FoodHerons\server\FoodHerons.Api.Tests\FoodHerons.Api.Tests.csproj`
      — all tests pass (0 failed).

- [ ] 11. Apply `0007_order_rpcs.sql` to the LIVE Supabase project over HTTPS. There is no
      HTTPS arbitrary-SQL channel in repo tooling (the seed script uses the JS SDK for data ops,
      not DDL; the README applies migrations via the dashboard SQL editor). **Document the single
      manual step:** open the Supabase dashboard for project `fozwmscvuzsrmwzortrr`
      (`https://fozwmscvuzsrmwzortrr.supabase.co`) → SQL editor → paste the entire contents of
      `supabase/migrations/0007_order_rpcs.sql` → Run. The service-role key for any scripted
      alternative is in `supabase/scripts/.env` as `SUPABASE_SERVICE_ROLE_KEY` (secret — never
      echo or commit it). Record in the implementation notes that this step is manual.
      Files: none (deployment; SQL authored in item 1)
      Verify: in the dashboard SQL editor, `select proname from pg_proc where proname in
      ('place_order','transition_order');` returns both rows — confirms the functions exist on the
      live project. (If an HTTPS SQL-exec RPC is later added, it can run this instead; today it is
      the one documented manual step.)

- [ ] 12. End-to-end live order over HTTPS. With the API configured with the real
      `Supabase:Url` (`https://fozwmscvuzsrmwzortrr.supabase.co`) and
      `Supabase__ServiceRoleKey` (from `supabase/scripts/.env`) via user-secrets / env, start the
      API, sign in as a student in the React client at `http://localhost:5173/cart`, and place a
      pre-order; confirm it returns 201 Created (no 500, no "failed to fetch") and the order row
      appears in Supabase. Then drive one transition (e.g. pending->preparing as the vendor owner)
      and confirm 200 OK. This exercises the two RPCs + the PostgREST reads over 443 — the original
      bug (`error 500 upon clicking "Confirm Pre-order"`) is resolved.
      Files: none (live verification)
      Verify: `POST /api/orders` returns 201 with a `code`/`placedAt`; a transition returns 200;
      no 5432/6543 socket is opened (all traffic is HTTPS 443). Document the outcome in the
      implementation notes.

---

## Notes / assumptions

- **Manual migration application (item 11) is the one unavoidable manual step.** The repo has no
  HTTPS "execute arbitrary SQL" endpoint; `supabase/README.md` establishes the dashboard SQL
  editor as the migration channel. The plan documents the exact paste-and-run step and the
  `pg_proc` existence check rather than inventing a channel that does not exist.
- **`Db` stays named `Db`** (design decision, lowest churn): keeps `OrdersEndpoints.cs` and tests
  compiling untouched. Only the constructor and method bodies change.
- **`ApplyTransitionAsync` keeps its `OrderService orderService` parameter** even though it no
  longer re-plans — the endpoint call site passes it and changing the signature would touch
  `OrdersEndpoints.cs` (out of scope). The under-lock re-plan relocates into the SQL whitelist
  (the single intentional behavior relocation per the design).
- **NIT 2 (per-item `vendor_id` always equals `p_vendor`)**: harmless and matches today's
  unconstrained `order_items.vendor_id` column; no action required beyond keeping the item-level
  `vendor_id` in the `place_order` body, which item 2/1 already do.
- `OrdersEndpoints.cs`, `OrderService.cs`, `OrderDomain.cs`, and everything under `Auth/` are
  **not modified**.
