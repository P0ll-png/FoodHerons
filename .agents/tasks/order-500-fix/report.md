# Report — HTTP 500 on "Confirm Pre-Order" (`POST /api/orders`)

## Summary

Clicking **Confirm Pre-Order** sent `POST /api/orders` to the C# order service, which returned a
bare HTTP 500. The service threw an unhandled exception on its first database call and had no
global exception handler to turn that into a clean response. The fix wraps the un-protected read
path, adds a global exception-handler safety net, fails fast on a missing connection string, and
locks the behavior with a regression test.

## Root cause (precise)

- **Where it throws:** `server/FoodHerons.Api/Endpoints/OrdersEndpoints.cs`, line **58**:
  ```csharp
  var vendor = await db.GetVendorAsync(vendorId, ct);
  ```
  This is the first DB call in `PlaceOrderAsync`. It runs through `GetVendorAsync` in
  `server/FoodHerons.Api/Data/Db.cs` (lines **48–66**), where `cmd.ExecuteReaderAsync(ct)` opens a
  connection.

- **Why it throws:** the Npgsql data source is built from `ConnectionStrings:Postgres`
  (`server/FoodHerons.Api/Program.cs` lines **25–30**), which is the empty string in both
  `appsettings.json` and `appsettings.Development.json`, with no user-secrets/.env supplying it.
  `NpgsqlDataSourceBuilder("").Build()` succeeds (connections open lazily), but the first command
  execution throws because there is no host to connect to.

- **Exception type:** an Npgsql/connection-configuration exception thrown from
  `NpgsqlCommand.ExecuteReaderAsync` (missing host / empty connection string). The observed subtype
  is in the `ArgumentException` / `InvalidOperationException` class (exact subtype depends on Npgsql
  10.0.3 internals). The key fact is that it is an unexpected exception, not a `DomainError`.

- **Why it reached the client as a raw 500:** the `GetVendorAsync` (line 58) and `GetMenuItemsAsync`
  (line 65) read calls were **outside** any `try/catch` — only the later `InsertOrderAsync` write
  (lines 71–85) was wrapped and mapped to a clean 500. `Program.cs` registered `AddProblemDetails()`
  but never called `app.UseExceptionHandler(...)`, so the unhandled exception surfaced as a bare 500
  with no ProblemDetails body.

Because the connection string was empty, every order placement hit this path — which matches the
reported "500 on every Confirm Pre-order" symptom.

## Fix applied

1. **`server/FoodHerons.Api/Program.cs`** — added `app.UseExceptionHandler(...)` as a global safety
   net that writes a clean 500 ProblemDetails with `code = "INTERNAL"` and
   `correlationId = TraceIdentifier` (matching `OrdersEndpoints.ServerError`) and logs the exception.
   Also added a fail-fast startup check that throws when `ConnectionStrings:Postgres` is null/empty,
   except under the `"Testing"` environment (so the DB-free test host still runs).
2. **`server/FoodHerons.Api/Endpoints/OrdersEndpoints.cs`** — wrapped the place-order read calls
   (`GetVendorAsync`, `GetMenuItemsAsync`) in the same try/catch → `ServerError(http, correlationId)`
   pattern already used for the write. Business branches (e.g. vendor closed) unchanged.
3. **`server/FoodHerons.Api/.env.example`** — documented that `ConnectionStrings__Postgres` must be
   supplied at runtime (user-secrets / env) and that the API now fails fast when it is missing.
4. **`server/FoodHerons.Api.Tests/FoodHerons.Api.Tests.csproj`** — added
   `Microsoft.AspNetCore.Mvc.Testing` 10.0.0.
5. **`server/FoodHerons.Api.Tests/OrderServiceEndpointFaultTests.cs`** (new) — a
   `WebApplicationFactory<Program>` test using environment `"Testing"`, an empty connection string,
   and a stub auth scheme yielding a `student` principal. It POSTs a validation-passing body so
   execution reaches `GetVendorAsync` and triggers the DB fault, then asserts status 500,
   ProblemDetails with `code == "INTERNAL"` and a non-empty `correlationId`, and that no raw
   exception/stack (`Npgsql`, `StackTrace`, `   at `) leaks to the client.

## Verification results

- **Environment:** .NET SDK `10.0.401` (net10.0), Windows/PowerShell. No live Postgres was reached;
  the fault was reproduced in-process with an empty connection string (the real operational trigger).

- **Build** — `dotnet build server/FoodHerons.sln`:
  **Build succeeded. 0 Warning(s), 0 Error(s).**

- **Tests** — `dotnet test server/FoodHerons.Api.Tests/FoodHerons.Api.Tests.csproj`:
  **Passed! Failed: 0, Passed: 61, Skipped: 0, Total: 61** (60 pre-existing + 1 new regression test).

- **Regression-guard proof:** with the fix temporarily reverted (`UseExceptionHandler` disabled and
  the read catch changed to `throw;`), the new test failed (**Failed: 1, Passed: 0**) — the exception
  propagated unhandled and the client got no clean ProblemDetails. Restoring the fix returned the
  suite to 61 passing, confirming the test guards the exact throwing path.

## What was and wasn't verified

- **Verified (in-process):** the empty-connection-string fault now returns a clean, correlated 500
  ProblemDetails instead of a leaked raw 500; the full unit suite passes (61/61).
- **Not verified (no live DB):** the 201 Created success path against a real Postgres. With a valid
  `ConnectionStrings__Postgres` the same code path persists the order and returns 201; supplying that
  connection string is the operational fix for the original error.
