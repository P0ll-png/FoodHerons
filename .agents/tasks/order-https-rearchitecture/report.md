# Report — Order-service HTTPS re-architecture (Supabase 443)

## Root-cause recap

Clicking **Confirm Pre-order** returned HTTP 500. The React client reached the C#
order API, but the API's data layer (`Data/Db.cs`) placed and transitioned orders
over a **raw Postgres socket** using Npgsql. That transport is dead on every network
the app runs on: the direct port 5432 and the pooler port 6543 both time out, and the
legacy direct host `db.fozwmscvuzsrmwzortrr.supabase.co` no longer resolves (Supabase
retired it). So the first DB call on `POST /api/orders` threw, and the clean global
handler turned it into the 500 the user saw ("An unexpected error occurred.").

Crucially, the Supabase project itself was alive the whole time: JWT sign-in worked
(the user's own `{"status":"ok"}` / 200 probe), and PostgREST answers over HTTPS 443
with the service-role key. **Raw Postgres is blocked; HTTPS works.** The fix moves the
data layer off the Postgres socket entirely and onto Supabase's HTTPS API.

## Final architecture

The pure order logic (`Services/OrderService.cs`, `Services/OrderDomain.cs`) and the
HTTP contract (status codes + the machine `code` values the React client branches on:
`ITEM_UNAVAILABLE`, `VENDOR_CLOSED`, `ILLEGAL_TRANSITION`, `VALIDATION`, `NOT_FOUND`,
`FORBIDDEN`, `INTERNAL`) are unchanged. Only `Data/Db.cs` and startup wiring changed.

- **Transport:** a typed `HttpClient` registered with `services.AddHttpClient<Db>()`,
  `BaseAddress = {Supabase:Url}/rest/v1/`, headers `apikey` + `Authorization: Bearer`
  = the **service-role key** (bypasses RLS, exactly as the old service-role connection
  did). The key is read from `Supabase:ServiceRoleKey` (env `Supabase__ServiceRoleKey`);
  it is never hardcoded. Config is read with no `!` assertions — `BaseAddress` is set
  only when the URL is non-blank and the auth headers only when the key is non-empty, so
  absent/empty config never throws at registration (an unconfigured send throws at call
  time → clean 500).
- **Reads (PostgREST GET):**
  - `GetVendorAsync` → `vendors?id=eq.{id}&select=id,owner_id,preorder_enabled,hours_open,hours_close&limit=1`;
    `[]` → `null`. The data layer **never** emits `VENDOR_CLOSED` — the endpoint decides
    `VENDOR_CLOSED` on the place path and `FORBIDDEN` on the transition owner check.
  - `GetMenuItemsAsync` → `menu_items?vendor_id=eq.{id}&id=in.(...)&select=id,name,price,available`;
    a requested id missing from the response is **absent from the map**, so
    `OrderService.ComputeOrder` still raises `ITEM_UNAVAILABLE`. Ids are double-quoted and
    `"`/`\`-escaped inside `in.(...)`, then URL-escaped (injection-safe).
  - `GetOrderStateAsync` → `orders?id=eq.{id}&select=id,status,student_id,vendor_id&limit=1`.
- **Writes (RPC POST `/rest/v1/rpc/<fn>`):** the two multi-statement writes that need
  atomicity/locking move into Postgres `SECURITY DEFINER` functions (migration `0007`):
  - `place_order(...)` inserts the `orders` row (DB assigns `id`/`code`/`placed_at`/default
    `pending` status) + all `order_items` from a `jsonb` array in one transaction, and
    `RETURNS public.orders`.
  - `transition_order(p_id, p_to, p_reason)` does `SELECT ... FOR UPDATE`, re-checks the
    5-pair legal whitelist under the lock, writes `status` + the matching lifecycle
    timestamp (+ `cancel_reason` on cancel), and raises `FH001` (illegal) / `FH002`
    (not found). It `RETURNS public.orders`.
  - Both return a **single composite row → single JSON object**, deserialized directly into
    `OrderRow` with **no array unwrap** and **no dependence on `Prefer: return=representation`**.
  - `ApplyTransitionAsync` keys `FH001`→`ILLEGAL_TRANSITION` (409) / `FH002`→`NOT_FOUND` (404)
    off the response-body `code` field **regardless of HTTP status** (status treated only as
    2xx-vs-not). Any other non-2xx / unparseable body → throw → clean 500. Supabase response
    bodies are never forwarded to the client.
- **Concurrency:** the authoritative HTTP-response planner stays `OrderService.PlanTransition`
  (the endpoint's pre-RPC check). The under-lock re-plan that the old Npgsql code did in C#
  relocates into the SQL whitelist inside `transition_order` — the single intentional behavior
  relocation. A unit test pins the SQL whitelist in sync with `OrderService.Legal`.
- **`IOrderData`/`Db` seam:** the type name `Db`, its namespace, the five method signatures,
  and the four record types (`VendorInfo`, `OrderState`, `OrderRow`, `OrderItemInput`) are
  preserved, so `OrdersEndpoints.cs` and the 61 existing tests compile untouched. Only the
  constructor (`HttpClient` instead of `NpgsqlDataSource`) and method bodies changed.

`OrderService.Legal` (mirrored exactly in `transition_order`):
`pending→preparing, preparing→ready, ready→completed, pending→cancelled, preparing→cancelled`.

## The full `0007_order_rpcs.sql`

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

## DI / config / startup changes

`Program.cs`:
- Removed `using Npgsql;`, the `NpgsqlDataSource` singleton, and `AddSingleton<Db>()`.
- Removed the Postgres-connection-string fail-fast.
- Added the Supabase fail-fast (missing `Supabase:Url` **or** `Supabase:ServiceRoleKey`),
  gated OUT for the `Testing` environment so `WebApplicationFactory` still boots.
- Added the typed client:

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

- `AddProblemDetails()` + the `UseExceptionHandler` clean-500 are unchanged.

`appsettings.json` / `appsettings.Development.json`: added `Supabase:ServiceRoleKey: ""`
(placeholder only — the real key lives in user-secrets / `Supabase__ServiceRoleKey`, never
committed) and removed the now-unused `ConnectionStrings:Postgres` block.

`FoodHerons.Api.csproj`: removed `<PackageReference Include="Npgsql" Version="10.0.3" />`.

`.env.example`: replaced the Postgres connection-string documentation with the
`Supabase__ServiceRoleKey` requirement (the new order-write dependency).

Tests:
- `OrderServiceEndpointFaultTests` — added a `ThrowingHandler : HttpMessageHandler` and
  registered it on the **typed** `Db` client in `FaultWebAppFactory.ConfigureTestServices`
  (`services.AddHttpClient<Db>().ConfigurePrimaryHttpMessageHandler(() => new ThrowingHandler())`)
  — zero network, still asserts the clean 500. Stale XML-doc summaries rewritten for the
  Supabase HTTPS transport. (A named `AddHttpClient("supabase")` override was deliberately
  NOT used — it would build a different, unused client.)
- `DbSupabaseTests` (new) — stub-handler unit tests for all five methods incl. the FH001/FH002
  body-code mapping (with a case under a non-400 status) and the no-leak invariant, plus the
  legal-set sync test.

## Verified live vs. not

Verified live over HTTPS 443 (see `verification.md` for commands + outputs):
- Build: 0 errors.
- Tests: 78/78 pass.
- PostgREST reachable with the service-role key.
- JWT sign-in mints a student token.
- `POST /api/orders` → `409 VENDOR_CLOSED` (vendor genuinely closed by PH hours) — proving
  JWT auth + `GetVendorAsync` over PostgREST + openness evaluation all work.
- With the vendor temporarily opened, `POST /api/orders` reached `rpc/place_order` and
  returned a **clean 500 `INTERNAL`** (correlationId, no leak) because the RPC does not exist
  yet. Vendor hours were restored; no orders were created.

NOT yet verified live (blocked on the one manual step below):
- A successful 201 Created order and a 200 transition. These require `0007_order_rpcs.sql`
  to be applied. The transport, auth, reads, pricing, openness, and clean-500 contract are
  all proven; only the RPC functions are missing.

## Remaining manual step (copy-paste)

There is no HTTPS arbitrary-SQL channel on this project (probed `rpc/exec_sql`,
`rpc/exec`, `rpc/query` → all 404) and no `supabase`/`psql` CLI locally. Per
`supabase/README.md`, migrations run in the dashboard SQL editor.

1. Open https://fozwmscvuzsrmwzortrr.supabase.co → SQL editor.
2. Paste the entire contents of `supabase/migrations/0007_order_rpcs.sql` → Run.

Verify (dashboard SQL editor):

```sql
select proname from pg_proc where proname in ('place_order','transition_order');
```

Expect both rows. Then place an order while the vendor is open (within 06:30–15:00 PH,
or temporarily widen `vendors.hours_open/hours_close`) and expect **HTTP 201** with an
order `id` + `code` — resolving the original "error 500 upon clicking Confirm Pre-order".
