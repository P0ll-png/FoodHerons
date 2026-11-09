# Order-service data layer re-architected onto Supabase HTTPS (443)

The order service placed and transitioned orders over a raw Postgres socket (Npgsql), a
transport that is dead on every network the app runs on (5432/6543 time out, the legacy direct
host no longer resolves), so `POST /api/orders` threw on its first DB call and surfaced the user's
500. This change moves the data layer entirely onto Supabase's HTTPS API: reads become PostgREST
GETs, and the two transactional writes become `SECURITY DEFINER` RPCs (`place_order`,
`transition_order`) invoked over `POST /rest/v1/rpc/...`. The `Db` type name, its five method
signatures, and the four record types are preserved so the endpoints and the existing test suite
compile untouched; only the constructor (`HttpClient` instead of `NpgsqlDataSource`) and method
bodies changed. `OrderService.cs`, `OrderDomain.cs`, and `OrdersEndpoints.cs` are untouched, and
the HTTP error-code contract the React client branches on is preserved exactly.

Watch for: the live RPC migration (`0007_order_rpcs.sql`) is **not yet applied** to the Supabase
project — this is a documented manual step (dashboard SQL editor), not a code defect (confirmed). A
successful 201 order and 200 transition cannot be exercised live until that runs; build + all 78
unit tests are green and the full HTTPS transport/auth/read path is proven live (confirmed via
verification.md).

**Verdict**: APPROVED

## High-level view

The data-layer rewrite lands exactly as designed. Reads build the correct PostgREST query strings
(`eq.` / `in.(...)` filters with URL- and quote-escaping) and map empty arrays to null; the two RPC
writes deserialize a single JSON object directly into `OrderRow` with no array unwrap and no
`Prefer`-header dependence. `ApplyTransitionAsync` keys `FH001`→`ILLEGAL_TRANSITION` and
`FH002`→`NOT_FOUND` off the response-body `code` field regardless of HTTP status, and every other
non-2xx throws a sanitized exception that never carries the Supabase body. The "missing menu id =
absent from map = unavailable" invariant is preserved, and the data layer never emits
`VENDOR_CLOSED` (the endpoint owns that decision).

The migration ships both RPCs as atomic `SECURITY DEFINER` functions returning `public.orders`.
`transition_order` does `SELECT ... FOR UPDATE` and guards the write with a 5-pair whitelist that
mirrors `OrderService.Legal` exactly, raising `FH001`/`FH002` with the right SQLSTATEs. The execute
lockdown revokes from `public` unconditionally and from `anon`/`authenticated` only when those roles
exist, so the migration also applies on a bare Postgres.

DI/startup is wired with a typed `AddHttpClient<Db>` whose config is fully guarded — no `!`
assertions, `BaseAddress` set only when the URL is non-blank, auth headers added only when the key
is non-empty, and registration never throws. The Supabase fail-fast is gated out under `Testing`;
the Npgsql package reference and the Postgres connection string are gone; the service-role key is
read from config/user-secrets and never hardcoded.

The fault test injects a `ThrowingHandler` on the typed `Db` client (not a named client), so the
clean-500 contract is asserted with zero network. New `DbSupabaseTests` cover PostgREST 2xx and
error bodies including the FH001/FH002 mapping (with an FH001 under a non-400 status to pin the
body-code-over-HTTP-status rule) and the no-leak invariant. A legal-set sync test pins the SQL
whitelist against `OrderService.Legal`.

<details>
<summary>Issues (1)</summary>

1. **Live RPC migration unapplied (non-blocking)** — `0007_order_rpcs.sql` must be run in the
   Supabase dashboard SQL editor for the live project before a real order returns 201. Documented
   as the single manual step with copy-paste SQL and a `pg_proc` verification query; not a code
   defect and explicitly in-scope as a remaining manual step.

</details>

<details>
<summary>Details</summary>

## Data-layer reads: PostgREST query construction

`GetVendorAsync` builds `vendors?id=eq.{escaped}&select=id,owner_id,preorder_enabled,hours_open,hours_close&limit=1`,
parses the JSON array, maps `[]` to null, and projects the first element into `VendorInfo` with
`owner_id` JSON null flowing into `Guid?` null via the `VendorDto`. It never emits `VENDOR_CLOSED` —
that decision stays in the endpoint (confirmed: `Db.cs` contains no `VENDOR_CLOSED` reference, and
`ErrorCodes.VendorClosed` lives only in `OrderDomain.cs`, unchanged).

`GetMenuItemsAsync` keeps the `Distinct(StringComparer.Ordinal)` + empty-input short-circuit (empty
set returns an empty map with no HTTP call), then builds the `in.(...)` filter. Each id is wrapped in
double quotes with embedded `"`/`\` backslash-escaped, then the whole quoted token is
`Uri.EscapeDataString`-d (`QuoteInValue`) — injection-safe. Ids absent from the response stay absent
from the map, so `OrderService.ComputeOrder` still raises `ITEM_UNAVAILABLE` for unknown/unavailable
items. This invariant is pinned by `GetMenuItemsAsync_builds_in_filter_and_maps_present_ids`
asserting `longsilog` is absent (confirmed).

## RPC writes: single-object deserialization, no array unwrap

Both `InsertOrderAsync` and `ApplyTransitionAsync` POST to `rpc/place_order` / `rpc/transition_order`
and read the response through `ReadObjectAsync<OrderRowDto>`, which deserializes a single JSON object
directly — no `[0]` indexing. Neither request sends `Prefer: return=representation`
(`PostAsJsonAsync` sends only the body), matching the design's definitive resolution that a function
`RETURNS public.orders` yields a single composite row serialized as a JSON object. The
`place_order` body carries the snake_case RPC argument names (`p_student`, `p_vendor`, `p_items` with
`menu_item_id`/`vendor_id`/`name`/`unit_price`/`qty`) via the `PlaceOrderRpcBody`/`PlaceOrderRpcItem`
DTOs, asserted by `InsertOrderAsync_posts_rpc_and_deserializes_single_object` (confirmed).

## Transition error mapping keyed off the body code, not HTTP status

`ApplyTransitionAsync` treats HTTP status only as 2xx-vs-not: on success it deserializes the object;
on any non-2xx it reads the body `code` and maps `FH001`→`ILLEGAL_TRANSITION` (409) /
`FH002`→`NOT_FOUND` (404), throwing a sanitized `Fatal` for any other or unparseable code. The
`ApplyTransitionAsync_maps_FH001_regardless_of_http_status` test pins this by returning `FH001` under
a 500 and asserting the mapping still fires — exactly the Finding-6 behavior. `TryReadErrorCodeAsync`
swallows `JsonException` to null (→ fatal throw), so an HTML/garbage error body cannot crash the
mapping, covered by `ApplyTransitionAsync_unparseable_error_body_throws`.

The `orderService` parameter is retained in the signature (the endpoint passes it) but no longer used
for planning — the under-lock re-plan relocated into the SQL whitelist, the single intentional
behavior relocation.

## No Supabase body ever leaks

`Fatal` composes a message from the operation name and status code only; `ReadObjectAsync` and
`GetArrayAsync` translate malformed JSON into a generic "malformed response" message. No code path
forwards `response.Content` text into an exception or a `DomainError`.
`InsertOrderAsync_throws_on_non_2xx_without_leaking_body` proves a unique-constraint message and its
`23505` code are both absent from the thrown exception (confirmed). The HTTP error-code contract
(`ITEM_UNAVAILABLE`, `VENDOR_CLOSED`, `ILLEGAL_TRANSITION`, `VALIDATION`, `NOT_FOUND`, `FORBIDDEN`,
`INTERNAL`) is preserved — the data layer emits only `ILLEGAL_TRANSITION`/`NOT_FOUND`; the endpoint
owns the rest.

## Migration 0007: atomicity, locking, and the mirrored whitelist

Both functions are `SECURITY DEFINER` with `set search_path = public` and return `public.orders`.
`place_order` inserts the order then the items from `jsonb_array_elements(p_items)` in one function
body (one transaction), letting the DB assign `id`/`code`/`placed_at`/default `pending`.
`transition_order` does `select status ... for update`, raises `FH002` when the row is gone, checks
the 5-pair whitelist, raises `FH001` on an illegal pair, and writes status + the matching lifecycle
timestamp (and `cancel_reason` only on cancel). The SQLSTATEs `FH001`/`FH002` line up with the C#
mapping.

The whitelist — `('pending','preparing')`, `('preparing','ready')`, `('ready','completed')`,
`('pending','cancelled')`, `('preparing','cancelled')` — matches `OrderService.Legal` line for line
(confirmed by reading both). `LegalTransitionSet_matches_0007_sql_whitelist` encodes the same 5 pairs
and asserts each is accepted by `OrderService.PlanTransition` while representative illegal pairs are
rejected by both sets, so silent drift fails the build.

The execute lockdown revokes from `public` unconditionally and wraps the `anon`/`authenticated`
revokes in a `do $$ ... if exists (select from pg_roles where rolname in ('anon','authenticated'))`
guard, so the migration applies cleanly on a bare Postgres lacking the Supabase roles.

## DI / startup wiring

`Program.cs` registers the typed `AddHttpClient<Db>` with fully guarded config: it reads
`Supabase:Url`/`Supabase:ServiceRoleKey` with no `!` assertions, sets `BaseAddress =
{url}/rest/v1/` only when the URL is non-blank, and adds the `apikey` + `Authorization: Bearer`
headers only when the key is non-empty — registration never throws for absent/empty config. The
typed overload also registers `Db`, replacing the old `AddSingleton<Db>()`. The `NpgsqlDataSource`
registration and `using Npgsql;` are gone, the Npgsql `PackageReference` is removed from the csproj
(a residual `using` would now fail the build — build is green, so none survives), and the Postgres
connection-string block is removed from both appsettings files. The fail-fast now checks the two
Supabase keys and is gated out under `Testing` so `WebApplicationFactory` boots. The service-role key
is read from config/env/user-secrets (`UserSecretsId` added) and never hardcoded — request paths are
relative without a leading slash, preserving the `/rest/v1/` base segment.

## Tests

`OrderServiceEndpointFaultTests` overrides the **typed** `Db` client's primary handler with a
`ThrowingHandler` via `services.AddHttpClient<Db>().ConfigurePrimaryHttpMessageHandler(...)` in
`ConfigureTestServices`. Because this runs after the app's own `AddHttpClient<Db>(configureClient)`,
the client's `BaseAddress` configuration is preserved and only the primary handler is swapped, so the
first data call throws with zero network and the test still asserts a clean 500 (`code=INTERNAL`,
non-blank `correlationId`, no `Npgsql`/`StackTrace`/`   at ` leak). Using the typed overload is the
correct choice — a named `AddHttpClient("supabase")` would build a different, unused client.

`DbSupabaseTests` drive a `StubHttpMessageHandler` that records the outgoing request and returns a
canned response. Coverage: vendor GET URL/header shape, `[]`→null, null `owner_id`; the `in.(...)`
filter with the absent-id-omitted invariant and the empty-input no-HTTP-call short-circuit; the
`place_order` POST body + single-object deserialize; the status read; transition success; the
FH001/FH002 mapping including an FH001 under a 500; unknown-code and unparseable-body throws; the
no-leak invariant; and the legal-set sync assertion.

Not tested: a live 201 order and a live 200 transition against the applied RPCs — blocked on the
manual migration step below, as documented. Build (0 errors) and 78/78 tests are recorded in
verification.md and the coder was instructed not to re-run them; the evidence is present, so no
re-run or spot-check was warranted.

## Live migration — documented manual step

`0007_order_rpcs.sql` is authored and committed but not applied to the live project (verification.md
shows `rpc/place_order` returning PGRST202 "function not found", and the repo has no HTTPS
arbitrary-SQL channel). This is the one unavoidable manual step: paste the file into the Supabase
dashboard SQL editor for project `fozwmscvuzsrmwzortrr` and run it, then confirm via
`select proname from pg_proc where proname in ('place_order','transition_order')`. Per the review
scope this is a documented remaining manual step with copy-paste SQL, not a blocking defect, given
build + unit tests are green.

</details>

<details>
<summary>File map</summary>

- `server/FoodHerons.Api/Data/Db.cs` — rewritten onto `HttpClient`; PostgREST reads + place_order/transition_order RPC writes; private snake_case DTOs; sanitized errors.
- `supabase/migrations/0007_order_rpcs.sql` — new; two `SECURITY DEFINER` RPCs returning `public.orders`, with the mirrored whitelist and guarded role lockdown.
- `server/FoodHerons.Api/Program.cs` — typed `AddHttpClient<Db>`, guarded config, Supabase fail-fast gated for Testing, Npgsql/NpgsqlDataSource removed.
- `server/FoodHerons.Api/FoodHerons.Api.csproj` — Npgsql PackageReference removed; `UserSecretsId` added.
- `server/FoodHerons.Api/appsettings.json` / `appsettings.Development.json` — `Supabase:ServiceRoleKey:""` placeholder added; `ConnectionStrings:Postgres` removed.
- `server/FoodHerons.Api/.env.example` — Postgres connection-string docs replaced with `Supabase__ServiceRoleKey`.
- `server/FoodHerons.Api.Tests/OrderServiceEndpointFaultTests.cs` — ThrowingHandler on the typed Db client; stale XML-docs rewritten.
- `server/FoodHerons.Api.Tests/DbSupabaseTests.cs` — new; stub-handler unit tests + legal-set sync test.
- `.agents/tasks/order-https-rearchitecture/report.md`, `verification.md` — docs.

Full diff: `git diff HEAD~1` (commit `e2b31e4`).

</details>
