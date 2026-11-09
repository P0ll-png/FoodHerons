# Design: Re-architect the order service data layer onto Supabase HTTPS (443)

## Overview

The FoodHerons order service currently places and transitions orders through a raw
Postgres connection using Npgsql (`server/FoodHerons.Api/Data/Db.cs`). That transport is
dead on every network the app runs on: ports 5432 (direct) and 6543 (pooler) time out, and
the legacy direct host `db.fozwmscvuzsrmwzortrr.supabase.co` no longer resolves because
Supabase retired it. The Supabase project itself is alive and fully reachable over HTTPS
(443) — the PostgREST endpoint returns live rows with the service-role key, and JWT sign-in
already works over 443. The fix is to move the data layer off the Postgres socket entirely
and onto Supabase's HTTPS API.

This design replaces the Npgsql data layer with a Supabase-backed implementation that uses
`HttpClient` (via `IHttpClientFactory`) against the PostgREST base `${Supabase:Url}/rest/v1`,
authenticated with the service-role key. Reads (`GetVendorAsync`, `GetMenuItemsAsync`) become
PostgREST GETs. The two writes that need transactional/locking guarantees — the atomic
order insert and the status transition — move into two new Postgres RPC functions
(`public.place_order`, `public.transition_order`) invoked over `POST /rest/v1/rpc/...`.

The pure order logic in `Services/OrderService.cs` and `Services/OrderDomain.cs` does **not**
change. The HTTP contract of the endpoints — status codes and the machine-readable `code`
values the React client branches on — is preserved exactly. The public surface of the data
layer (its method signatures and the `VendorInfo` / `OrderState` / `OrderRow` /
`OrderItemInput` record types) is preserved so the endpoints and the 61-test suite compile
with minimal churn.

## Technology stack (locked once approved)

- **Runtime / framework:** ASP.NET minimal API on .NET 10 (SDK 10.0.401). Unchanged.
- **HTTP transport:** `System.Net.Http.HttpClient` obtained from `IHttpClientFactory`
  (`AddHttpClient`), which ships in the ASP.NET shared framework — **no new NuGet package**.
- **Serialization:** `System.Text.Json` (already a transitive/framework dependency; already
  used in `Auth/SupabaseJwt.cs`). No Newtonsoft, no Supabase C# SDK.
- **Supabase API:** PostgREST for reads, Postgres RPC (plpgsql `SECURITY DEFINER` functions)
  for the two transactional writes. Called over HTTPS 443 with the service-role key.
- **Database:** the existing Supabase Postgres schema in `supabase/migrations/`. Two new RPC
  functions are added as a new migration `0007_order_rpcs.sql`.
- **Tests:** xUnit + `Microsoft.AspNetCore.Mvc.Testing` (`WebApplicationFactory<Program>`),
  as today. Data-layer unit tests use a stub `HttpMessageHandler` — no new package.

Rationale for no Supabase C# SDK: the data layer needs exactly four operations and precise
control over headers, status-code handling, and error mapping. A hand-rolled typed client
over `HttpClient` is smaller, has zero new dependencies, and is trivial to unit-test with a
fake handler. The official `supabase-csharp` SDK would add a dependency surface and its own
error model that we would then have to re-map to our `DomainError` codes anyway.

## Current state (what we are replacing)

`Db` is a `sealed class` taking an `NpgsqlDataSource` and exposing:

- `GetVendorAsync(string vendorId, ct) -> VendorInfo?` — single-row SELECT.
- `GetMenuItemsAsync(string vendorId, IEnumerable<string> ids, ct) -> IReadOnlyDictionary<string, MenuItemInfo>`
  — multi-row SELECT; **missing ids are simply absent from the map**, and the caller
  (`OrderService.ComputeOrder`) treats an absent id as `ITEM_UNAVAILABLE`.
- `InsertOrderAsync(...) -> OrderRow` — one transaction inserting `orders` + N `order_items`;
  DB assigns `code` (sequence default) and `placed_at`; returns the new row via `RETURNING`.
- `GetOrderStateAsync(Guid id, ct) -> OrderState?` — non-locking status read for the
  pre-transition authorization/not-found check in the endpoint.
- `ApplyTransitionAsync(OrderService, id, to, reason, ct) -> Result<OrderRow>` — opens a
  transaction, `SELECT ... FOR UPDATE`, **re-plans the transition under the lock** via
  `OrderService.PlanTransition` (lost-race safety), updates `status` + the matching lifecycle
  timestamp (+ `cancel_reason` on cancel), returns the updated row.

`Program.cs` registers an `NpgsqlDataSource` from `ConnectionStrings:Postgres`, registers
`Db`, and **fails fast at startup** when that connection string is empty (except in the
`Testing` environment). It also installs a `UseExceptionHandler` that renders a clean 500
`ProblemDetails` with `code=INTERNAL` + `correlationId`.

`OrdersEndpoints.cs` wraps every data-layer call in `try/catch -> ServerError` (clean 500),
and maps `DomainError`s to `ProblemDetails` with codes `ITEM_UNAVAILABLE`, `VENDOR_CLOSED`,
`ILLEGAL_TRANSITION`, `VALIDATION`, `NOT_FOUND`, `FORBIDDEN`, `INTERNAL`. These are consumed
by the React client and **must not change**.

## Target architecture

### The DI seam stays identical; only the implementation changes

The endpoints inject `Db` by concrete type (`Db db` parameters in `PlaceOrderAsync`,
`TransitionAsync`, `IsVendorOwnerAsync`). To keep endpoint and test churn minimal we keep a
type named `Db` with the **same five public method signatures and the same record types**,
but re-implement its body against `HttpClient`. The class is renamed internally in spirit
("Supabase-backed data layer") but the **type name `Db` and namespace `FoodHerons.Api.Data`
are retained** so `OrdersEndpoints.cs` compiles without edits and the DI registration key is
unchanged. The constructor changes from `(NpgsqlDataSource)` to `(HttpClient)` (or
`(IHttpClientFactory)`); this is an internal detail invisible to the endpoints.

Decision: keep the name `Db`. Renaming to e.g. `SupabaseOrderStore` is cleaner but would
touch `OrdersEndpoints.cs` in ~6 places and any test that references the type. The task
explicitly allows renaming "as long as the DI contract the endpoints use is preserved," and
the lowest-churn way to preserve it is to keep the name. The XML doc comment on the class is
updated to describe the HTTPS/PostgREST/RPC transport.

### HttpClient registration (Program.cs)

> **Changed to satisfy Finding 2 (MEDIUM) and Finding 5 (MEDIUM).** The snippet no longer uses
> any `!` non-null assertions on config, and the client is registered with the **typed** overload
> `AddHttpClient<Db>` (keyed internally by the type name `Db`, not a named `"supabase"` client).

Register a **typed** client so headers and base address are configured once. The configuration
rule is: **read `Supabase:Url` and `Supabase:ServiceRoleKey` without any `!` assertion; set
`BaseAddress` only when the URL is non-empty, composing `new Uri($"{baseUrl.TrimEnd('/')}/rest/v1/")`;
add the `apikey` and `Authorization: Bearer <key>` headers only when the key is non-empty. An
absent or empty value for either MUST NOT throw at registration time** — a request issued against
an unconfigured client (null `BaseAddress`) throws at send time, which the endpoint `try/catch`
turns into the clean 500.

```csharp
builder.Services.AddHttpClient<Db>(client =>
{
    var baseUrl = builder.Configuration["Supabase:Url"];
    var key = builder.Configuration["Supabase:ServiceRoleKey"];

    if (!string.IsNullOrWhiteSpace(baseUrl))
        client.BaseAddress = new Uri($"{baseUrl.TrimEnd('/')}/rest/v1/");

    if (!string.IsNullOrWhiteSpace(key))
    {
        client.DefaultRequestHeaders.Add("apikey", key);
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
    }
});
```

Notes:
- Typed-client registration (`AddHttpClient<Db>`) also registers `Db` itself, replacing the
  old `AddSingleton<Db>()`. `Db` becomes transient (the typed-client default); that is fine —
  it holds no per-request state beyond the injected `HttpClient`. **Because this is a typed
  client, its message handler is keyed internally by the type name `Db`, not by any string name.
  Any test override of the primary handler MUST re-use the typed overload `AddHttpClient<Db>()`
  — a named `AddHttpClient("supabase")` registration would build a *different*, unused client
  and never reach the handler the `Db` instance receives (Finding 5).**
- **Absent/empty config never throws at registration (Finding 2).** `BaseAddress` is set only
  when `Supabase:Url` is non-empty, and the `apikey`/`Authorization` headers are added only when
  `Supabase:ServiceRoleKey` is non-empty. With both absent (e.g. under `Testing`), the client is
  created with a null `BaseAddress` and no auth headers; it throws only if a request is actually
  sent through it — the endpoint `try/catch` then yields the clean 500.
- `BaseAddress` ends with a trailing slash and the request paths are **relative without a
  leading slash** (`vendors?...`, `rpc/place_order`) so `Uri` composition keeps the
  `/rest/v1/` segment. This is a correctness detail the implementation must honor.
- The service-role key bypasses RLS, exactly like the old service-role connection string did,
  so the existing `orders`/`order_items` write path and the unrestricted vendor/menu reads
  behave the same.
- The key is **never hardcoded**. It is read from `Supabase:ServiceRoleKey`
  (env `Supabase__ServiceRoleKey`), sourced from `dotnet user-secrets` locally. `appsettings.json`
  gains a `Supabase:ServiceRoleKey: ""` placeholder only (no real value committed).

### Reads via PostgREST

`GetVendorAsync(vendorId)` issues:

```
GET vendors?id=eq.{vendorId}&select=id,owner_id,preorder_enabled,hours_open,hours_close&limit=1
```

The response is a JSON array. An empty array maps to `null` (vendor not found); a single
element is deserialized into `VendorInfo`. `vendorId` is a text slug and is URL-escaped with
`Uri.EscapeDataString` before interpolation into the `eq.` filter.

`GetMenuItemsAsync(vendorId, ids)` first distinct-filters the ids (preserving the existing
`StringComparer.Ordinal` + empty-input short-circuit behavior), then issues:

```
GET menu_items?vendor_id=eq.{vendorId}&id=in.({id1},{id2},...)&select=id,name,price,available
```

The returned array is projected into a `Dictionary<string, MenuItemInfo>` keyed by `id`.
**Any requested id not present in the response is simply absent from the map** — identical to
the Npgsql version — so `OrderService.ComputeOrder` still raises `ITEM_UNAVAILABLE` for
unknown/unavailable items. Each id is URL-escaped and, because PostgREST `in.(...)` treats
commas as separators and allows reserved characters inside double quotes, each id is wrapped
in double quotes (`id=in.("a","b")`) and any embedded `"` or `\` is backslash-escaped. Menu
item ids in this schema are simple slugs, but quoting makes the filter robust and injection-safe.

PostgREST returns `price` as a JSON number for a `numeric(10,2)` column; it deserializes
cleanly into `decimal`. `owner_id` may be JSON `null` -> `Guid?` null.

### Writes via RPC

The atomic order insert and the locked transition cannot be expressed safely as a sequence of
PostgREST calls — PostgREST gives one HTTP request = one implicit transaction, so two
separate calls are two transactions with no shared lock. Both writes therefore move into
plpgsql functions invoked via `POST rpc/{fn}` with a JSON body of the named arguments.

`InsertOrderAsync(...)` calls:

```
POST rpc/place_order
Content-Type: application/json
{
  "p_student":  "<uuid>",
  "p_vendor":   "<vendorId>",
  "p_subtotal": 42.00,
  "p_total":    42.00,
  "p_pickup":   "Juan",
  "p_note":     null,
  "p_items": [
    { "menu_item_id": "tapsilog", "vendor_id": "tita-nenas", "name": "Tapsilog", "unit_price": 42.00, "qty": 1 }
  ]
}
```

The function inserts the `orders` row (letting the DB assign `code` and `placed_at`), then
the `order_items` rows, in one transaction, and returns the new order row. The C# side
deserializes the returned row into `OrderRow`. Because `status` starts as `pending` and the
accepted/ready/completed/cancelled timestamps and `cancel_reason` are null at creation, those
fields map to the same values the old code hardcoded.

> **Response shape — definitive (Finding 4, MEDIUM).** A function declared `RETURNS public.orders`
> returns a **single composite row**, which PostgREST serializes (under the default
> `Accept: application/json`) as a **single JSON object**, not a one-element array. `InsertOrderAsync`
> (and `ApplyTransitionAsync`) therefore deserialize directly into `OrderRow` with **no array unwrap
> / no `[0]` indexing**. The composite row is returned regardless of any `Prefer` header, so the
> request **does not send `Prefer: return=representation`** and must not depend on it. (The earlier
> `Prefer: return=representation` line was removed from the request sketch above.)

`ApplyTransitionAsync(orderService, id, to, reason)` — concurrency decision below — calls:

```
POST rpc/transition_order
{ "p_id": "<uuid>", "p_to": "preparing", "p_reason": null }
```

and deserializes the returned updated order row **(a single JSON object — same composite-return
shape as `place_order`, no array unwrap)** into `OrderRow`, or interprets a structured
"no legal transition" result as a `DomainError` (see "Concurrency" and "Error mapping").

`GetOrderStateAsync(id)` stays a plain PostgREST read:

```
GET orders?id=eq.{id}&select=id,status,student_id,vendor_id&limit=1
```

Empty array -> `null` (the endpoint turns that into `NOT_FOUND`). Note PostgREST returns the
enum `status` as its text label already, so the old `status::text` cast is unnecessary.

## Concurrency decision: RPC for the transition (chosen) vs optimistic PostgREST update

Two options satisfy lost-race safety:

**Option A — second RPC `public.transition_order`.** The function does
`SELECT status ... FOR UPDATE`, decides the legal next state and the matching timestamp
column *in SQL*, updates atomically, and returns the updated row (or signals an illegal
transition). This exactly mirrors today's `FOR UPDATE` + re-plan-under-lock behavior.

**Option B — optimistic PostgREST conditional update.** `OrderService.PlanTransition` runs in
C# against the status read a moment earlier, then a single
`PATCH orders?id=eq.{id}&status=eq.{expectedFrom}` sets the new status/timestamp; **0 rows
updated** means another writer moved the order first (lost race), which the C# side maps to
`ILLEGAL_TRANSITION` (or re-reads to distinguish `NOT_FOUND`).

**Chosen: Option A (the RPC).** Reasons:

1. **Preserves the existing guarantee with no behavior drift.** Today's correctness rests on
   `FOR UPDATE` serializing concurrent transitions and re-planning under the lock. The RPC
   keeps that exact mechanism server-side. Option B swaps a pessimistic lock for optimistic
   concurrency — a real semantic change whose lost-race detection depends on PostgREST's
   affected-row count and an extra round trip to disambiguate not-found from lost-race.
2. **Single network round trip, atomic.** Option B needs the status read (already done by the
   endpoint via `GetOrderStateAsync`) plus the conditional PATCH, and a 0-row result may need
   a third call to tell `NOT_FOUND` from `ILLEGAL_TRANSITION`. The RPC does it in one request
   and returns enough to decide.
3. **Symmetry with `place_order`.** We are already adding one RPC for the atomic insert;
   adding the transition RPC keeps both multi-statement writes in the same, testable place.

**Transition-planning authority stays in `OrderService` (constraint #4), with the under-lock guard in SQL.** The HTTP-response planning authority — the legal-transition state machine that decides what the client sees — is NOT duplicated into SQL. `transition_order` is a *mechanical* executor: it takes the already-validated target status `p_to`, locks the row, reads the current status itself, and refuses only on the two conditions the C# planner cannot see atomically — the order vanished, or the `(from -> to)` pair is not legal at the moment of the locked write.

> **Corrected to satisfy Finding 1 (MEDIUM), Finding 2 (MEDIUM), Finding 3 (NIT).** An earlier
> draft described a different, self-contradictory mechanism (the RPC "returns the locked current
> status," `ApplyTransitionAsync` "re-plans in C#," and the RPC "accepts the expected current
> status"). That contradicted the authoritative `0007` SQL, the error table, and the test
> strategy in this same document, and has been replaced by the flow below.

`transition_order` does **NOT** take an expected-current-status parameter. It reads the current status itself under `FOR UPDATE` and guards the write with the whitelist; the caller passes only `p_id`, `p_to`, and `p_reason`. The flow is:

- The endpoint still calls `GetOrderStateAsync` and `OrderService.PlanTransition(state.Status, to)`
  for the authorization routing (student-cancel vs vendor-action) and the fast-path illegal
  rejection, exactly as today. **This pre-RPC `PlanTransition` is the only C# planning call.**
- `transition_order` performs the locked read and evaluates the 5-pair whitelist (the mirror of
  `OrderService.Legal`) under the lock, then does the timestamp/`cancel_reason` write; an illegal
  `(from, to)` raises `FH001` and a vanished row raises `FH002`. It **never** returns a bare
  status for C# to re-plan.
- `ApplyTransitionAsync` does **NOT** re-plan after the RPC. It maps the response-body `code`
  field (`FH001` => `ILLEGAL_TRANSITION`, `FH002` => `NOT_FOUND`) per the error table and
  Finding 6. The SQL whitelist is the atomic guard for the lost-race window between the endpoint's
  pre-check and the locked write.

That 5-pair whitelist is a **mirror** of `OrderService.Legal`, kept minimal and covered by a test that asserts the SQL set and the C# set agree. **The re-plan-under-lock that today's Npgsql code performs in C# moves into the SQL whitelist — this is the single intentional behavior relocation in the design, not a drift.** The *authoritative* planner for HTTP responses remains `OrderService`; the SQL whitelist only guards the atomic write.

Rationale for the small mirror: a plpgsql function that locks a row cannot call back into C#.
To keep the lock and the decision atomic we need the legal set available inside SQL. We
accept a 5-row duplicated whitelist as the price of atomicity, and we pin it with a test (see
Test strategy) so the two can never silently diverge. This is exactly why the under-lock re-plan
relocates from C# into the whitelist: the atomic decision must live where the lock lives.

## Migration SQL (new file `0007_order_rpcs.sql`)

Add `supabase/migrations/0007_order_rpcs.sql`, following the existing header/comment style and
numeric ordering (runs after `0006_seed.sql`). The same SQL is applied to the live project.

```sql
-- FoodHerons — Phase B — 0007_order_rpcs.sql
-- RPC functions backing the HTTPS (PostgREST) order service, per the
-- order-https-rearchitecture design. Run AFTER 0006_seed.sql.
--
-- Both functions are SECURITY DEFINER and intended to be called by the C#
-- service with the service-role key over POST /rest/v1/rpc/<fn>. They
-- encapsulate the two multi-statement writes that cannot be done atomically
-- across separate PostgREST calls:
--   place_order       — insert orders + order_items in one transaction
--   transition_order  — locked read + guarded status/timestamp update
--
-- Transition-planning AUTHORITY lives in C# OrderService. The whitelist here
-- is a deliberate minimal mirror of OrderService.Legal, guarding the atomic
-- write only. A C# test asserts the two sets stay in sync.

-- ===========================================================================
-- place_order(): atomic order + items insert. DB assigns code + placed_at.
-- Returns the new orders row (RETURNS orders -> PostgREST sends it back).
-- ===========================================================================
create or replace function public.place_order(
  p_student  uuid,
  p_vendor   text,
  p_subtotal numeric,
  p_total    numeric,
  p_pickup   text,
  p_note     text,
  p_items    jsonb
)
  returns public.orders
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_order public.orders;
begin
  insert into public.orders (student_id, vendor_id, subtotal, total, pickup_name, note)
  values (p_student, p_vendor, p_subtotal, p_total, p_pickup, p_note)
  returning * into v_order;

  insert into public.order_items (order_id, menu_item_id, vendor_id, name, unit_price, qty)
  select
    v_order.id,
    elem->>'menu_item_id',
    elem->>'vendor_id',
    elem->>'name',
    (elem->>'unit_price')::numeric,
    (elem->>'qty')::integer
  from jsonb_array_elements(p_items) as elem;

  return v_order;
end;
$$;

-- Lock down execute. revoke from public always applies; the anon/authenticated
-- revokes are guarded so this migration also runs on a bare Postgres that lacks
-- the Supabase roles (Finding 7).
revoke all on function public.place_order(uuid, text, numeric, numeric, text, text, jsonb) from public;
do $$
begin
  if exists (select from pg_roles where rolname in ('anon', 'authenticated')) then
    revoke all on function public.place_order(uuid, text, numeric, numeric, text, text, jsonb) from anon, authenticated;
  end if;
end
$$;

-- ===========================================================================
-- transition_order(): locked read + guarded status/timestamp update.
-- Returns the updated orders row on success. Raises a typed exception with
-- SQLSTATE 'FH001' (illegal transition) or 'FH002' (not found) that the C#
-- layer maps to ILLEGAL_TRANSITION / NOT_FOUND. The legal (from,to) set below
-- is a MIRROR of OrderService.Legal.
-- ===========================================================================
create or replace function public.transition_order(
  p_id     uuid,
  p_to     text,
  p_reason text
)
  returns public.orders
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_from  text;
  v_order public.orders;
  v_legal boolean;
begin
  -- Lock the row and read its current status (lost-race tie-break).
  select status::text into v_from
  from public.orders
  where id = p_id
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'FH002';
  end if;

  -- Minimal mirror of OrderService.Legal (5 pairs). Kept in sync by a C# test.
  v_legal := (v_from, p_to) in (
    ('pending',   'preparing'),
    ('preparing', 'ready'),
    ('ready',     'completed'),
    ('pending',   'cancelled'),
    ('preparing', 'cancelled')
  );

  if not v_legal then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'FH001';
  end if;

  update public.orders
     set status       = p_to::public.order_status,
         accepted_at  = case when p_to = 'preparing'  then now() else accepted_at  end,
         ready_at     = case when p_to = 'ready'      then now() else ready_at     end,
         completed_at = case when p_to = 'completed'  then now() else completed_at end,
         cancelled_at = case when p_to = 'cancelled'  then now() else cancelled_at end,
         cancel_reason = case when p_to = 'cancelled' then p_reason else cancel_reason end
   where id = p_id
  returning * into v_order;

  return v_order;
end;
$$;

-- Same guarded lockdown as place_order (Finding 7).
revoke all on function public.transition_order(uuid, text, text) from public;
do $$
begin
  if exists (select from pg_roles where rolname in ('anon', 'authenticated')) then
    revoke all on function public.transition_order(uuid, text, text) from anon, authenticated;
  end if;
end
$$;
```

Notes on the SQL:

- Both functions are `SECURITY DEFINER` with a pinned `search_path = public`, matching the
  style of every function in `0004_functions_triggers.sql`. Because the C# service calls them
  with the **service-role key** (which already bypasses RLS), `SECURITY DEFINER` is belt-and-
  suspenders; the explicit `revoke ... from public` plus the guarded
  `revoke ... from anon, authenticated` ensures a leaked anon/authenticated token can never call
  them directly. **(Finding 7)** The `anon`/`authenticated` revokes are wrapped in a
  `do $$ ... if exists (select from pg_roles where rolname in ('anon','authenticated')) ... $$`
  block so the migration also applies cleanly on a bare Postgres (e.g. a CI instance) that does
  not have the Supabase roles, instead of aborting with `role "anon" does not exist`. The
  `revoke ... from public` is unconditional (the `public` pseudo-role always exists).
- `place_order` returns `public.orders`, so PostgREST responds with the full order row
  (including the sequence-assigned `code` and `placed_at`) as a JSON object. `transition_order`
  likewise returns `public.orders`. The C# side deserializes the object into `OrderRow`
  (selecting the columns it needs; extra columns like `student_id`/`note` are ignored).
- The RPC bodies never touch the legal-transition *routing* (student vs vendor) — that stays
  in C#. The whitelist here only prevents an atomic write that the planner would reject.
- `jsonb_array_elements` over `p_items` keeps the N-item insert set-based and in-transaction.
- All CHECK constraints (`qty > 0`, `subtotal/total >= 0`) and FKs still apply inside the
  function; a violation raises and the whole RPC transaction rolls back (see error mapping).

## DI / config / startup changes (Program.cs, appsettings.json)

1. **Remove** the `using Npgsql;` import, the `NpgsqlDataSource` singleton registration, and
   the `AddSingleton<Db>()` line. Add `builder.Services.AddHttpClient<Db>(...)` as shown above.
2. **Replace the Postgres fail-fast** with a Supabase fail-fast, gated the same way for the
   `Testing` environment so `FaultWebAppFactory` still boots:

   ```csharp
   var supabaseUrl = builder.Configuration["Supabase:Url"];
   var serviceRoleKey = builder.Configuration["Supabase:ServiceRoleKey"];
   if ((string.IsNullOrWhiteSpace(supabaseUrl) || string.IsNullOrWhiteSpace(serviceRoleKey))
       && !builder.Environment.IsEnvironment("Testing"))
   {
       throw new InvalidOperationException(
           "Missing Supabase REST configuration. Set 'Supabase:Url' and " +
           "'Supabase:ServiceRoleKey' (env 'Supabase__ServiceRoleKey') via dotnet " +
           "user-secrets or environment variables before starting the API.");
   }
   ```

   The fail-fast is skipped under `Testing` so `WebApplicationFactory<Program>` boots. The
   typed-client factory (see "HttpClient registration") reads the same two keys and **never
   throws at registration regardless of their values** (Finding 2): it sets `BaseAddress` only
   when the URL is non-empty and adds the auth headers only when the key is non-empty.

   > **Correction (Finding 1, MEDIUM).** An earlier draft claimed that under `Testing` the config
   > is empty, `BaseAddress` is left null, and the fault test's 500 therefore comes from a
   > null-`BaseAddress` `InvalidOperationException`. **That is factually wrong and has been
   > deleted.** The shipped `server/FoodHerons.Api/appsettings.json` sets
   > `Supabase:Url = "https://YOUR-PROJECT-REF.supabase.co"` — a **non-empty placeholder** — and
   > `WebApplicationFactory` loads that same file under `Testing` (`FaultWebAppFactory` does not
   > override it). So the typed client would get a **valid, non-null** `BaseAddress`
   > (`https://YOUR-PROJECT-REF.supabase.co/rest/v1/`), and a 500 would arise only from a **real
   > outbound HTTPS attempt** to a non-resolving host — a DNS/connect failure that is
   > network-dependent and potentially slow or flaky. The fault test must not rely on that.
   >
   > **Deterministic fix (owned by the test, Findings 1 + 5).** `FaultWebAppFactory` makes the
   > fault path network-free by overriding the **typed** `Db` client's primary handler with a
   > handler that always throws:
   >
   > ```csharp
   > // In FaultWebAppFactory.ConfigureTestServices:
   > services.AddHttpClient<Db>()
   >         .ConfigurePrimaryHttpMessageHandler(() => new ThrowingHandler());
   > // ThrowingHandler.SendAsync throws new HttpRequestException("fault-test") — zero network.
   > ```
   >
   > It uses the **typed** overload `AddHttpClient<Db>()`, not a named `AddHttpClient("supabase")`
   > (a named override builds a different, unused client that never reaches the `Db` instance —
   > Finding 5). Optionally it may also pin a fast-failing loopback URL via
   > `builder.UseSetting("Supabase:Url", "http://127.0.0.1:1")` as defense in depth, but the
   > throwing handler is what guarantees zero network. With this override, the first data call
   > (`GetVendorAsync`) throws, the endpoint `try/catch` turns it into the clean 500
   > `ProblemDetails` (`code=INTERNAL`, `correlationId`, no `Npgsql`/stack leak), and **no real
   > network call is made** — exactly what the fault test asserts.
3. **`appsettings.json`:** add `"ServiceRoleKey": ""` under the existing `Supabase` section.
   Remove the now-unused `ConnectionStrings:Postgres` entry (or leave an empty placeholder;
   removing is cleaner since nothing reads it on the request path). The real key lives only in
   user-secrets / environment (`Supabase__ServiceRoleKey`) and in
   `supabase/scripts/.env` as `SUPABASE_SERVICE_ROLE_KEY` for tooling — never committed.
4. **Npgsql package:** the request path no longer opens a Postgres socket. The `Npgsql`
   `PackageReference` in `FoodHerons.Api.csproj` can be **removed** because no code references
   it after `Db` is rewritten (the record types move with `Db` and have no Npgsql dependency).
   Decision: remove it. Nothing in this repo's request path or migration tooling (migrations
   are plain `.sql` applied via the Supabase dashboard/CLI, not an Npgsql-based runner) needs
   the driver. Removing it guarantees no accidental Postgres-socket code path survives.

## Error mapping

The endpoints already translate `DomainError` -> `ProblemDetails` and catch exceptions ->
clean 500 `INTERNAL`. The data layer must feed those seams the same way the Npgsql version
did. The rule: **recoverable, meaningful failures become `DomainError`s with the existing
codes; everything else throws and is caught by the endpoint `try/catch` (or the global
handler) as `INTERNAL`.** Supabase/PostgREST response bodies are **never** forwarded to the
client — on a non-2xx we log the status and a short reason server-side with the
`correlationId`, and surface only the mapped code.

| Operation | Failure condition | Recoverable? | What the data layer does | Caller sees | Logged |
|---|---|---|---|---|---|
| `GetVendorAsync` GET | Non-2xx from PostgREST, network error, timeout, malformed JSON | Fatal | Throw (wrap in a concise `InvalidOperationException`, no response body) | Endpoint `try/catch` -> 500 `INTERNAL` + `correlationId` | Yes, `LogError` with status + correlationId |
| `GetVendorAsync` GET | 200 with empty array | Expected | Return `null` (the data layer NEVER emits `VENDOR_CLOSED` itself) | **Endpoint decides by context (Finding 3):** place-order path (`PlaceOrderAsync` null/closed branch) => `VENDOR_CLOSED`; owner check on the transition path (`IsVendorOwnerAsync`) => contributes to `FORBIDDEN` | No |
| `GetMenuItemsAsync` GET | Non-2xx / network / malformed JSON | Fatal | Throw | 500 `INTERNAL` | Yes |
| `GetMenuItemsAsync` GET | 200, some requested ids absent | Expected | Those ids absent from the map | `OrderService.ComputeOrder` -> `ITEM_UNAVAILABLE` | No |
| `GetOrderStateAsync` GET | Non-2xx / network / malformed JSON | Fatal | Throw | 500 `INTERNAL` | Yes |
| `GetOrderStateAsync` GET | 200 with empty array | Expected | Return `null` | Endpoint -> `NOT_FOUND` | No |
| `InsertOrderAsync` RPC | 2xx | Success | Return `OrderRow` | 201 Created | Info (order placed) |
| `InsertOrderAsync` RPC | Non-2xx (constraint violation, DB error), network, timeout, malformed JSON | Fatal | Throw | 500 `INTERNAL` | Yes |
| `ApplyTransitionAsync` RPC | 2xx | Success | Return `Result.Ok(OrderRow)` | 200 OK | Info (transitioned) |
| `ApplyTransitionAsync` RPC | PostgREST error with SQLSTATE `FH001` (illegal) | Recoverable | Return `Result.Fail(ILLEGAL_TRANSITION 409)` | 409 `ILLEGAL_TRANSITION` | No (expected lost-race) |
| `ApplyTransitionAsync` RPC | PostgREST error with SQLSTATE `FH002` (not found) | Recoverable | Return `Result.Fail(NOT_FOUND 404)` | 404 `NOT_FOUND` | No |
| `ApplyTransitionAsync` RPC | Any other non-2xx / network / malformed JSON | Fatal | Throw | 500 `INTERNAL` | Yes |

How the SQLSTATE reaches C# **(clarified per Finding 6, NIT)**: when `transition_order` executes
`raise exception ... using errcode = 'FH001'|'FH002'`, PostgREST serializes it as a JSON object
whose `code` field equals the SQLSTATE, e.g. `{"code":"FH001","message":"...","details":...,"hint":...}`.
For a custom SQLSTATE outside PostgREST's special-cased classes the status is typically HTTP 400,
but that is **version/proxy-dependent** (newer PostgREST honors `PTxxx`/`PGRST` channels that can
override the status). **`ApplyTransitionAsync` therefore keys its mapping off the response-body
`code` field, NOT off the HTTP status**: it treats the status only as **2xx (success) vs non-2xx
(error)**, and on any non-2xx it reads the body and extracts the `code` field. `FH001` =>
`ILLEGAL_TRANSITION`, `FH002` => `NOT_FOUND`; the rest of the body is discarded (never surfaced to
the client). Any non-2xx response whose body it cannot parse, or whose `code` is neither `FH001`
nor `FH002`, is treated as fatal -> throw -> `INTERNAL`. The design does **not** hardcode or
depend on the error being exactly HTTP 400. To keep `OrderService` the planning authority, the endpoint's own
pre-check (`PlanTransition` against `GetOrderStateAsync`) still rejects obviously-illegal moves
with `ILLEGAL_TRANSITION` *before* the RPC; `FH001` only fires on a genuine lost race between
the pre-check and the locked write.

Validation of external inputs (request body shape, pickup-name/note/qty/reason bounds) is
unchanged — it stays in `OrderService.ValidatePlaceOrder` / `ValidateTransition`, runs before
any network call, and already returns `VALIDATION` (422) `DomainError`s. The data layer adds
no new external-input validation; its only "inputs" are already-validated domain values and
trusted config. Config inputs (`Supabase:Url`, `Supabase:ServiceRoleKey`): required, non-empty
strings, enforced at startup by the fail-fast (outside `Testing`); on failure the process
refuses to start with the message above.

## Invariants and which layer owns them

- **Atomicity of order creation** (orders + all items, or nothing): owned by the DB inside
  `place_order` (single transaction). The C# side cannot guarantee this across HTTP calls, so
  it is pushed to SQL — the reason the RPC exists.
- **Lost-race safety of transitions** (no two writers both succeed): owned by the DB inside
  `transition_order` via `FOR UPDATE` + the whitelist guard. C# does a best-effort pre-check
  (`PlanTransition` against `GetOrderStateAsync`); the atomic under-lock authority is the RPC.
  The re-plan-under-lock that the old Npgsql code did in C# **relocates into the SQL whitelist** —
  the one intentional behavior relocation, not a drift. `ApplyTransitionAsync` does not re-plan
  after the RPC; it maps the body `code` (`FH001`/`FH002`) per Finding 6.
- **Legal-transition state machine (HTTP response authority)**: owned by `OrderService.Legal` /
  `PlanTransition` in C#, invoked only by the endpoint's pre-RPC check. The SQL whitelist is a
  guarded mirror used solely for the atomic write, pinned in sync by a test.
- **Server-authoritative pricing** (client sends no prices): owned by `OrderService.ComputeOrder`
  using menu rows the data layer fetched. Unchanged.
- **"Missing menu id = unavailable"**: owned jointly — the data layer guarantees absent ids are
  absent from the map; `OrderService` interprets absence as `ITEM_UNAVAILABLE`. Preserved.
- **No secret/response-body leakage**: owned by the data layer (throws sanitized exceptions,
  never forwards Supabase bodies) and the endpoint/global handler (clean 500). Preserved.

## Files to change

- `server/FoodHerons.Api/Data/Db.cs` — rewrite the five methods against `HttpClient`
  (PostgREST GETs + RPC POSTs). Keep the type name `Db`, the namespace, the method
  signatures, and the four record types. Change the constructor to take `HttpClient`.
  Remove `using Npgsql;`. Add a small private JSON DTO/record set for PostgREST payloads
  (vendor row, menu row, order row, the `place_order` items array) plus the error-code reader.
  **Update the class XML-doc summary (Finding 8):** the current
  `/// The Npgsql-backed data layer... All SQL is parameterized` is stale — replace it with a
  summary describing the Supabase HTTPS transport (typed `HttpClient` against
  `${Supabase:Url}/rest/v1/`, PostgREST reads, `place_order`/`transition_order` RPC writes).
- `server/FoodHerons.Api/Program.cs` — swap the fail-fast condition to Supabase config;
  replace the `NpgsqlDataSource` + `AddSingleton<Db>` with `AddHttpClient<Db>(...)`; remove
  `using Npgsql;`.
- `server/FoodHerons.Api/appsettings.json` — add `Supabase:ServiceRoleKey: ""`; drop the
  `ConnectionStrings:Postgres` entry.
- `server/FoodHerons.Api/FoodHerons.Api.csproj` — remove the `Npgsql` PackageReference.
- `supabase/migrations/0007_order_rpcs.sql` — new migration with the two RPCs (SQL above).
- `server/FoodHerons.Api.Tests/` — add `DbSupabaseTests.cs` (fake-handler unit tests). Modify
  `OrderServiceEndpointFaultTests.cs`: add a `ThrowingHandler : HttpMessageHandler` whose
  `SendAsync` throws, register it on the typed client inside `FaultWebAppFactory.ConfigureTestServices`
  (`services.AddHttpClient<Db>().ConfigurePrimaryHttpMessageHandler(() => new ThrowingHandler())`),
  and **update the two stale XML-doc summaries (Finding 8):** the test-class summary and the
  `FaultWebAppFactory` summary currently say the request "reaches the first DB call (GetVendorAsync)
  with an empty connection string and throws" — rewrite them to describe the Supabase
  HTTPS/PostgREST/RPC transport and the throwing-handler fault injection (no Npgsql, no connection
  string). The test's response-only assertions (status, `code`, `correlationId`, no
  `Npgsql`/stack leak) stay as-is.

`OrdersEndpoints.cs`, `OrderService.cs`, `OrderDomain.cs`, and everything under `Auth/` are
**not modified**.

## Integration points / APIs called

- `GET  {Supabase:Url}/rest/v1/vendors?id=eq...&select=...`
- `GET  {Supabase:Url}/rest/v1/menu_items?vendor_id=eq...&id=in.(...)&select=...`
- `GET  {Supabase:Url}/rest/v1/orders?id=eq...&select=id,status,student_id,vendor_id&limit=1`
- `POST {Supabase:Url}/rest/v1/rpc/place_order`
- `POST {Supabase:Url}/rest/v1/rpc/transition_order`

All over HTTPS 443, headers `apikey: <service-role>` and `Authorization: Bearer <service-role>`.

## Edge cases

- **Empty item list / duplicate menu ids:** already merged and bounds-checked by
  `OrderService` before the data layer runs; `GetMenuItemsAsync` still short-circuits on an
  empty id set and returns an empty map.
- **Vendor exists but closed / preorder disabled:** handled by the endpoint's existing
  null/closed branch using `VendorInfo` fields; no data-layer change.
- **`owner_id` null** (vendor with no owner): deserializes to `Guid?` null; the
  `IsVendorOwnerAsync` check returns false, yielding `FORBIDDEN` as today.
- **Note is null vs empty:** endpoint already normalizes blank -> null before calling
  `InsertOrderAsync`; the RPC stores `p_note` as-is (null -> SQL null).
- **Lost race on transition:** endpoint pre-check passes, but another writer transitions first;
  `transition_order`'s locked whitelist fails -> `FH001` -> `ILLEGAL_TRANSITION` 409. Matches
  the old `FOR UPDATE` re-plan outcome.
- **Order deleted between pre-check and RPC:** `FH002` -> `NOT_FOUND` 404.
- **PostgREST returns the enum as text:** `GetOrderStateAsync`/`OrderRow` read `status` as a
  plain string; no `::text` cast needed.
- **Trailing slash / relative URL composition:** `BaseAddress` ends in `/rest/v1/` and request
  paths omit the leading slash so the version segment is retained.
- **Service-role key present but wrong/expired:** PostgREST returns 401/403; data layer treats
  any non-2xx on reads/inserts as fatal -> `INTERNAL` 500 (not leaked).

## Test strategy

**Regression guard — `OrderServiceEndpointFaultTests` (updated per Findings 1 + 5).**
This test boots the real `Program` under the `Testing` environment and asserts that a
validation-passing `POST /api/orders` produces a clean 500 `ProblemDetails`
(`code=INTERNAL` + `correlationId`, no `Npgsql`/stack leak). Its public assertions do not change.

> **Correction (Finding 1).** The earlier claim that the 500 comes from a null `BaseAddress`
> under "empty `Testing` config" is wrong and has been removed: `appsettings.json` ships the
> non-empty placeholder `Supabase:Url = "https://YOUR-PROJECT-REF.supabase.co"`, which
> `WebApplicationFactory` loads under `Testing`, so `BaseAddress` would be a valid non-null URI
> and the only way to produce a 500 without the fix is a real DNS/connect attempt — flaky and
> network-dependent.

To make the fault path **deterministic and network-free**, `FaultWebAppFactory.ConfigureTestServices`
overrides the **typed** `Db` client's primary handler with a throwing stub:

```csharp
services.AddHttpClient<Db>()                               // typed overload — same type key as Db
        .ConfigurePrimaryHttpMessageHandler(() => new ThrowingHandler());
// ThrowingHandler : HttpMessageHandler; SendAsync throws new HttpRequestException("fault-test").
```

This is the **typed** overload `AddHttpClient<Db>()` — a named `AddHttpClient("supabase")`
override would create a different, unused client and never reach the handler the `Db` instance
uses (Finding 5). Optionally the factory may also set `builder.UseSetting("Supabase:Url",
"http://127.0.0.1:1")` as defense-in-depth, but the throwing handler is what guarantees zero
network. `GetVendorAsync` now throws synchronously-from-the-handler, the endpoint `try/catch`
turns it into the clean 500, and **no real network call occurs**. The `DoesNotContain("Npgsql", ...)`
assertion stays valid (now trivially true). The four pure `OrderService*` test classes do not
touch the data layer and are unaffected — all 61 existing tests must still pass alongside the new
ones.

**What is added — data-layer unit tests with a stub `HttpMessageHandler`.** Add
`DbSupabaseTests.cs`. A small `StubHttpMessageHandler` records the outgoing `HttpRequestMessage`
(method, URI, headers, body) and returns a canned `HttpResponseMessage`. Construct `Db` with
`new HttpClient(stub) { BaseAddress = new Uri("https://x.test/rest/v1/") }`. Cases:

- `GetVendorAsync` builds the expected `vendors?id=eq...&select=...` URL, sends `apikey`/`Bearer`
  headers, parses a one-element array into `VendorInfo`, and returns `null` for `[]`.
- `GetMenuItemsAsync` builds the `in.(...)` filter, maps present ids, and **omits absent ids**
  (asserting the unavailable-semantics invariant). Empty input -> no HTTP call, empty map.
- `InsertOrderAsync` POSTs `rpc/place_order` with the correct JSON argument names and item
  array, and deserializes the returned order object into `OrderRow` (code + placed_at populated).
- `GetOrderStateAsync` parses the status read; `[]` -> `null`.
- `ApplyTransitionAsync` success returns `Result.Ok`; a non-2xx body `{"code":"FH001",...}` maps
  to `Result.Fail(ILLEGAL_TRANSITION)` and `{"code":"FH002",...}` to `NOT_FOUND` — **the mapping
  keys off the body `code` field, not the HTTP status (Finding 6)**, so a case asserting the same
  mapping under a non-400 error status is worth including. An unparseable body, or a non-2xx body
  whose `code` is neither `FH001` nor `FH002`, throws (asserted via `Assert.ThrowsAsync`).
- A non-2xx on any read/insert throws and the body is **not** present in the exception message
  (assert the Supabase body string is absent) — the no-leak invariant.

**Legal-set sync test.** Add a test that asserts the C# `OrderService.Legal` set equals the
SQL whitelist. Since the test cannot run live SQL, encode the SQL whitelist as a constant
string list in the test (copied from the migration) and assert it equals the projection of
`OrderService.Legal`; a mismatch fails the build, forcing both to be updated together. (If a
reviewer prefers, this can instead be an integration test against a live/CI Postgres, but the
constant-mirror test needs no DB and still prevents silent drift.)

**What is unit- vs integration-testable.** Everything above is unit-testable with the fake
handler — no network, no Postgres. The RPC *SQL itself* (transaction rollback on constraint
violation, `FOR UPDATE` serialization, sequence-assigned `code`) is only truly verifiable with
a live Postgres and is therefore covered by manual/integration verification against the live
Supabase project (apply `0007`, place an order, drive a transition, race two transitions).
This split is called out so the SQL is not assumed covered by the C# unit tests.

## Out of scope

- Any change to `OrderService`/`OrderDomain` logic, the auth stack, the React client, or the
  HTTP contract/error codes.
- Restoring raw Postgres connectivity (explicitly abandoned — the ports time out).
- A read API for orders (there is none; reads are served client-side under RLS).
- Retry/circuit-breaker policies on the `HttpClient` (could be added later via Polly; not
  required to fix the outage and would add a dependency — deferred).

## Review response (revision log)

This revision incorporates the design review in `design-review.md` /
`design-verdict.json` (verdict `CHANGES_REQUESTED`: 0 HIGH, 5 MEDIUM, 3 NIT). The core
architecture was verified correct against the real schema and source and is unchanged. Each
finding is addressed below; every change is also marked inline in the affected section.

1. **MEDIUM — fault-test boot mechanism was factually wrong. ADDRESSED.** Deleted the "empty
   `Supabase:Url` => null `BaseAddress` under `Testing`" explanation (the shipped
   `appsettings.json` ships the non-empty placeholder `https://YOUR-PROJECT-REF.supabase.co`,
   which `WebApplicationFactory` loads under `Testing`). The fault path is now made deterministic
   and network-free by overriding the typed `Db` client's primary handler with a `ThrowingHandler`
   in `FaultWebAppFactory.ConfigureTestServices`, optionally plus a loopback URL. Updated in
   "DI / config / startup changes" item 2 and the "Test strategy" regression-guard paragraph.

2. **MEDIUM — no `!` non-null assertions on config. ADDRESSED.** The `AddHttpClient<Db>`
   snippet now reads `Supabase:Url`/`Supabase:ServiceRoleKey` without `!`, sets `BaseAddress`
   only when the URL is non-empty (`new Uri($"{baseUrl.TrimEnd('/')}/rest/v1/")`), and adds the
   `apikey` + `Authorization: Bearer <key>` headers only when the key is non-empty. Absent/empty
   config never throws at registration. Stated as one coherent rule in "HttpClient registration".

3. **MEDIUM — error-mapping clarity for a null vendor. ADDRESSED.** The error table row for
   `GetVendorAsync` empty-array now says the data layer returns `null` and NEVER emits
   `VENDOR_CLOSED`; the endpoint decides by context (place-order path => `VENDOR_CLOSED`; owner
   check on the transition path => contributes to `FORBIDDEN`).

4. **MEDIUM — RPC response shape is definitive. ADDRESSED.** Removed the ambiguous
   `Prefer: return=representation` line from the `place_order` request sketch and added a
   definitive note: both RPCs (`RETURNS public.orders`) serialize as a single JSON object, so
   the client deserializes directly into `OrderRow` with no array unwrap and does not depend on
   the `Prefer` header. Mirrored in the `transition_order` description.

5. **MEDIUM — test override targets the typed client. ADDRESSED.** The registration notes and
   the Test-strategy section now state the override must use the typed overload
   `services.AddHttpClient<Db>().ConfigurePrimaryHttpMessageHandler(...)`, and warn that a named
   `AddHttpClient("supabase")` override creates a different, unused client that never reaches
   the `Db` instance.

6. **NIT — SQLSTATE-to-HTTP mapping. ADDRESSED.** The "How the SQLSTATE reaches C#" prose now
   states `ApplyTransitionAsync` keys the `FH001`/`FH002` mapping off the response-body `code`
   field regardless of HTTP status (status treated only as 2xx-vs-not); it no longer hardcodes
   or depends on HTTP 400. The Test-strategy case was updated to match.

7. **NIT — guard the `revoke ... from anon, authenticated`. ADDRESSED.** Both revokes in
   `0007_order_rpcs.sql` now split into an unconditional `revoke ... from public` plus a
   `do $$ ... if exists (select from pg_roles where rolname in ('anon','authenticated')) ... $$`
   guard, so the migration also runs on a bare Postgres lacking the Supabase roles. Documented
   in the SQL notes.

8. **NIT — stale XML-doc comments. ADDRESSED.** "Files to change" now calls for rewriting the
   `Db.cs` class summary (drop "The Npgsql-backed data layer…") and the
   `OrderServiceEndpointFaultTests` / `FaultWebAppFactory` summaries (drop "empty connection
   string and throws") to describe the Supabase HTTPS/PostgREST/RPC transport and the
   throwing-handler fault injection.

### Finalization pass (second review: `design-verdict.json` = `CHANGES_REQUESTED`, 2 MEDIUM + 1 NIT)

The second review confirmed all 8 corrections above are present and correctly grounded in the
real source/schema; the only blocker was a localized conflict in the Concurrency section whose
prose contradicted the authoritative SQL, error table, and test strategy. All three findings are
addressed below; the core architecture is unchanged.

1. **MEDIUM — Concurrency prose contradicted the RPC contract. ADDRESSED.** Deleted the two
   sentences claiming the RPC "returns the locked current status" and that `ApplyTransitionAsync`
   "invokes `OrderService.PlanTransition` again"/"re-plans in C#." Replaced with prose that matches
   the `0007` SQL and the error table: `transition_order` evaluates the 5-pair whitelist under the
   lock and raises `FH001` (illegal) / `FH002` (not found); `ApplyTransitionAsync` does NOT re-plan,
   it maps the body `code` (`FH001` => `ILLEGAL_TRANSITION`, `FH002` => `NOT_FOUND`) per Finding 6;
   the endpoint's pre-RPC `PlanTransition(GetOrderStateAsync.Status, to)` is the only C# planning
   call, and the SQL whitelist is the atomic guard for the lost-race window.

2. **MEDIUM — garbled/contradictory "expected current status" sentence. ADDRESSED.** Replaced the
   broken sentence with: "`transition_order` does NOT take an expected-current-status parameter. It
   reads the current status itself under `FOR UPDATE` and guards the write with the whitelist; the
   caller passes only `p_id`, `p_to`, and `p_reason`." This matches the actual RPC signature
   `(p_id uuid, p_to text, p_reason text)` and removes any invitation to add a `p_from`/`p_expected`
   parameter.

3. **NIT — "re-plan under the lock in C#" framing was misleading. ADDRESSED.** Added an explicit
   line in both the Concurrency section and the Invariants section stating the re-plan-under-lock
   **moves from C# into the SQL whitelist** and that this is the single intentional behavior
   relocation (not a drift).
