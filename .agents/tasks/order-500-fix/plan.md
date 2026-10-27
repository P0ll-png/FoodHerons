# Fix Plan — HTTP 500 on "Confirm Pre-Order" (`POST /api/orders`)

## Summary

Clicking **Confirm Pre-Order** sends `POST /api/orders` to the C# order service. The service
throws an **unhandled exception on the first database call** and returns a raw HTTP 500 because
(a) the Postgres connection string is empty in configuration, and (b) that first DB call is not
wrapped in `try/catch`, and (c) there is no global exception-handler middleware to convert an
unhandled exception into a clean ProblemDetails.

This is a true internal fault (not a 4xx business error). The correct behavior is a **successful
placement** once the DB is configured, plus a **defense-in-depth fix** so any future unhandled
exception maps to a clean `500` ProblemDetails with a `correlationId` instead of leaking.

---

## Root cause (precise, with evidence)

### Primary cause — unhandled DB exception on an un-wrapped read, caused by an empty connection string

- **Where it throws:** `server/FoodHerons.Api/Endpoints/OrdersEndpoints.cs`, line **58**:
  ```csharp
  var vendor = await db.GetVendorAsync(vendorId, ct);
  ```
  This is the **first** database call in `PlaceOrderAsync`. It executes
  `GetVendorAsync` → `server/FoodHerons.Api/Data/Db.cs` lines **48–66**, where
  `_dataSource.CreateCommand(sql)` + `cmd.ExecuteReaderAsync(ct)` opens a connection.

- **Why it throws:** the Npgsql data source is built from `ConnectionStrings:Postgres`
  (`server/FoodHerons.Api/Program.cs` lines **25–30**), which is the **empty string `""`** in both
  `server/FoodHerons.Api/appsettings.json` and `appsettings.Development.json`. There is **no
  `UserSecretsId`** in `server/FoodHerons.Api/FoodHerons.Api.csproj`, **no `.env`** file in the API
  folder (only `.env.example`), and `Program.cs` does **not** load a `.env`. So at runtime the
  effective connection string is empty. `NpgsqlDataSourceBuilder("").Build()` succeeds (connections
  open lazily), but the first command execution throws an Npgsql/`ArgumentException`-class exception
  ("Host can't be null" / missing host) because there is nothing to connect to.

- **Exception type:** an `Npgsql`/connection-configuration exception thrown from
  `NpgsqlCommand.ExecuteReaderAsync` (host/connection string not specified). The exact subtype
  depends on Npgsql 10.0.3 internals (observed class: `ArgumentException`/`InvalidOperationException`
  for an empty host); the key fact for the fix is that it is an **unexpected exception, not a
  `DomainError`**.

- **Why it reaches the client as a raw 500:** this call is **outside** any `try/catch`. Only the
  later `InsertOrderAsync` call (OrdersEndpoints.cs lines **71–85**) is wrapped and mapped to a clean
  500 via `ServerError(...)`. The two read calls before it —
  `GetVendorAsync` (line 58) and `GetMenuItemsAsync` (line 65) — are **not** wrapped. And
  `Program.cs` registers `AddProblemDetails()` but never calls `app.UseExceptionHandler(...)`
  (confirmed: no `UseExceptionHandler`/`UseStatusCodePages` anywhere in `server/**`), so an
  unhandled exception is surfaced as a bare 500 with no ProblemDetails body.

### Evidence that the business/logic path itself is correct (ruled-out candidates)

- **No DTO/JSON binding mismatch.** The JS body `{ vendorId, pickupName, note, items:[{menuItemId, qty}] }`
  maps cleanly to `PlaceOrderRequest(string? VendorId, string? PickupName, string? Note, LineItemDto[]? Items)`
  and `LineItemDto(string? MenuItemId, int Qty)` in `server/FoodHerons.Api/Dtos/OrderDtos.cs`
  (System.Text.Json is case-insensitive by default; all reference members are nullable, so a missing
  field binds to null and is caught by `ValidatePlaceOrder` as a **422**, not a 500).
- **No menu-item id-type mismatch.** `menu_items` has composite PK `(vendor_id, id)` with `id text`
  (`supabase/migrations/0003_tables.sql` lines 79–93). Seed ids are text slugs like `tapsilog`
  (`supabase/scripts/seed-demo.mjs`), and the client sends those same slugs. `GetMenuItemsAsync`'s
  `where vendor_id = @vendor_id and id = any(@ids)` matches correctly.
- **No decimal/NUMERIC error.** `price numeric(10,2)` ↔ C# `decimal`; `info.Price * qty` and the
  subtotal sum are decimal arithmetic. `ComputeOrder` returns a **422 ITEM_UNAVAILABLE** for an
  unknown/unavailable item — not a 500.
- **An un-configured DB would 500 on *every* order**, which matches the reported symptom exactly.

### Secondary observation (same class of defect)

The transition endpoint's reads (`GetOrderStateAsync`, `IsVendorOwnerAsync` →
`GetVendorAsync`) in `TransitionAsync` are likewise **not** wrapped in `try/catch`
(OrdersEndpoints.cs lines ~119–140). The global-handler fix below also covers these.

---

## Correct behavior

- With a valid connection string, `POST /api/orders` should **succeed** (201 Created with the
  `PlaceOrderResponse`). The empty connection string is the operational trigger.
- Any genuinely unexpected exception (DB down, transient Npgsql fault, misconfig) must return a
  **clean `500` ProblemDetails** with `code = "INTERNAL"` and a `correlationId`, never a raw stack/leak.
- Business failures remain **4xx ProblemDetails** with their existing machine codes
  (`VALIDATION` 422, `ITEM_UNAVAILABLE` 422, `VENDOR_CLOSED` 409, `ILLEGAL_TRANSITION` 409).

---

## Implementation Plan

- [ ] 1. Register a global exception handler so ANY unhandled exception becomes a clean 500 ProblemDetails with a correlationId.
      Add `app.UseExceptionHandler(...)` in `server/FoodHerons.Api/Program.cs` immediately after
      `var app = builder.Build();` and before `app.UseCors(...)`. In the handler, read the current
      `HttpContext`, log the exception via `ILoggerFactory`/`ILogger`, and write a `ProblemDetails`
      with `Status = 500`, `Title = "An unexpected error occurred."`, `Extensions["code"] = "INTERNAL"`,
      and `Extensions["correlationId"] = httpContext.TraceIdentifier` — matching the exact shape
      already produced by `OrdersEndpoints.ServerError(...)`. Keep `AddProblemDetails()`.
      This is the primary safety net that stops the raw leak; it alone converts the current symptom
      from a bare 500 into a clean, correlated 500.
      Files: `server/FoodHerons.Api/Program.cs`
      Verify: `dotnet build server/FoodHerons.Api/FoodHerons.Api.csproj` succeeds (0 errors).

- [ ] 2. Wrap the place-order READ calls in the same try/catch → clean-500 pattern already used for the write.
      In `server/FoodHerons.Api/Endpoints/OrdersEndpoints.cs` `PlaceOrderAsync`, move the
      `GetVendorAsync` (line 58) and `GetMenuItemsAsync` (line 65) calls into a `try` that, on any
      exception, logs with `http.TraceIdentifier` and returns `ServerError(http, correlationId)` —
      identical to the existing `InsertOrderAsync` catch block (lines 71–85). This gives the read
      path the same correlated 500 behavior as the write path (consistency; the handler in item 1 is
      the outer net).
      Files: `server/FoodHerons.Api/Endpoints/OrdersEndpoints.cs`
      Verify: `dotnet build server/FoodHerons.Api/FoodHerons.Api.csproj` succeeds; existing unit
      tests still pass (`dotnet test server/FoodHerons.Api.Tests` → 60 passing).

- [ ] 3. Make the empty/missing connection string a clear, fail-fast configuration error instead of a confusing per-request DB crash.
      In `server/FoodHerons.Api/Program.cs`, when `builder.Configuration.GetConnectionString("Postgres")`
      is null/empty AND the environment is not a test host, throw at startup with a message naming the
      missing key (`ConnectionStrings:Postgres` / env `ConnectionStrings__Postgres`). Preserve the
      existing "builds/runs with no live DB" behavior for the test host by gating the throw on
      `builder.Environment.IsEnvironment("Testing")` (the integration test in item 5 sets this). This
      turns a silent misconfiguration into an actionable startup error and documents the real operational fix.
      Files: `server/FoodHerons.Api/Program.cs`
      Verify: `dotnet build server/FoodHerons.Api/FoodHerons.Api.csproj` succeeds.

- [ ] 4. Document the required runtime connection string so the operational root cause is fixed, not just masked.
      Update `server/FoodHerons.Api/.env.example` guidance is already present; add a short note in it
      (and/or a README line next to the server project if one exists) stating that
      `ConnectionStrings__Postgres` MUST be supplied via `dotnet user-secrets`/env before
      `POST /api/orders` works, and that `appsettings*.json` ships an intentionally empty value. No
      secret values are committed.
      Files: `server/FoodHerons.Api/.env.example`
      Verify: manual read — the note names `ConnectionStrings__Postgres` and the user-secrets/env
      mechanism. (Documentation only; no build impact.)

- [ ] 5. Add a regression test that exercises the EXACT throwing path and asserts a clean 500 ProblemDetails.
      Add `Microsoft.AspNetCore.Mvc.Testing` (version aligned to net10.0 / the ASP.NET Core shared
      framework) to `server/FoodHerons.Api.Tests/FoodHerons.Api.Tests.csproj`. Create a new test class
      `OrderServiceEndpointFaultTests` (new file
      `server/FoodHerons.Api.Tests/OrderServiceEndpointFaultTests.cs`) using a
      `WebApplicationFactory<Program>` configured with environment `"Testing"`, an **empty**
      `ConnectionStrings:Postgres`, and a test JWT/auth setup that yields a `student` principal (stub
      the JWT bearer handler or inject a test authentication scheme so the request passes
      `RequireAuthorization` and the `student` role check — do not call live Supabase). It must POST a
      **validation-passing** body (valid `vendorId`, `pickupName`, one item with `qty` 1) so execution
      reaches `GetVendorAsync` and triggers the DB fault. Assert: response status is **500**, body is
      JSON ProblemDetails with `code == "INTERNAL"` and a non-empty `correlationId`, and the raw
      exception/stack is NOT present. This asserts the leak is fixed and the fault is correlated.
      Rationale for a new class: the existing four test classes are pure DB-free `OrderService` unit
      tests; the throwing path is at the endpoint/DB boundary, which needs the in-memory host.
      Files: `server/FoodHerons.Api.Tests/FoodHerons.Api.Tests.csproj`,
      `server/FoodHerons.Api.Tests/OrderServiceEndpointFaultTests.cs`
      Verify: `dotnet test server/FoodHerons.Api.Tests` → all tests pass (60 existing + the new
      fault test). Confirm the new test FAILS when item 1's handler and item 2's try/catch are
      reverted (proves it guards the real regression).

- [ ] 6. Full regression + build gate.
      Run the whole server test suite and build to confirm nothing regressed and the new coverage is green.
      Files: none (verification only).
      Verify: from `server/FoodHerons.Api.Tests`, `dotnet test` reports `failed: 0` with the new
      test included; `dotnet build server/FoodHerons.Api/FoodHerons.Api.csproj` succeeds with 0
      warnings/errors.

---

## Notes / assumptions

- Build/test commands verified during exploration: SDK `10.0.401` (net10.0); baseline
  `dotnet test` in `server/FoodHerons.Api.Tests` = **60 passed, 0 failed**. There are no project-level
  AGENTS.md/CONTRIBUTING/`.kiro/steering` docs (only `node_modules` copies), so project conventions
  were taken from the existing code (ProblemDetails shape, `ServerError` helper, xUnit `[Fact]`/`[Theory]` style).
- **No live Postgres was reached**; this diagnosis is from static reading plus the unit tests and the
  confirmed-empty connection configuration. The regression test deliberately reproduces the fault
  **in-process** (empty connection string) rather than requiring a live DB.
- Items 1 and 2 are the behavioral fix for the leaking 500; item 3/4 address the operational root
  cause (empty connection string) so a correctly configured deployment returns 201 on success;
  item 5 locks it with a test on the exact throwing path.
