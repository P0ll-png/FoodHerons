# Verification — HTTP 500 on "Confirm Pre-Order" (`POST /api/orders`)

## Environment
- .NET SDK: `10.0.401` (net10.0)
- OS: Windows (PowerShell)
- No live Postgres was reached. The fault was reproduced **in-process** with an
  empty connection string (the real operational trigger), per the plan.

## Root cause (confirmed)
`PlaceOrderAsync` made its first DB call (`GetVendorAsync`) **outside** any
try/catch. With `ConnectionStrings:Postgres` empty in `appsettings*.json`, that
first command execution throws an Npgsql/config exception. Because `Program.cs`
registered `AddProblemDetails()` but never called `app.UseExceptionHandler(...)`,
the exception surfaced as a bare HTTP 500 with no ProblemDetails body. This is an
internal fault, not a 4xx business condition.

## Changes
1. `server/FoodHerons.Api/Program.cs`
   - Added `app.UseExceptionHandler(...)` (global safety net) that writes a clean
     500 ProblemDetails with `code = "INTERNAL"` and `correlationId =
     TraceIdentifier`, matching `OrdersEndpoints.ServerError`. Logs the exception.
   - Added fail-fast startup check: throws when `ConnectionStrings:Postgres` is
     null/empty, except under the `"Testing"` environment (keeps the DB-free test
     host working).
2. `server/FoodHerons.Api/Endpoints/OrdersEndpoints.cs`
   - Wrapped the place-order READ calls (`GetVendorAsync`, `GetMenuItemsAsync`) in
     the same try/catch → `ServerError(http, correlationId)` pattern already used
     for the `InsertOrderAsync` write. Business branches (vendor closed) unchanged.
3. `server/FoodHerons.Api/.env.example`
   - Documented that `ConnectionStrings__Postgres` MUST be supplied at runtime
     (user-secrets / env) and that the API now fails fast when it is missing.
4. `server/FoodHerons.Api.Tests/FoodHerons.Api.Tests.csproj`
   - Added `Microsoft.AspNetCore.Mvc.Testing` 10.0.0.
5. `server/FoodHerons.Api.Tests/OrderServiceEndpointFaultTests.cs` (new)
   - `WebApplicationFactory<Program>` with environment `"Testing"`, empty
     connection string, and a stub auth scheme yielding a `student` principal.
     POSTs a validation-passing body so execution reaches `GetVendorAsync` and
     triggers the DB fault. Asserts status 500, ProblemDetails with
     `code == "INTERNAL"` and a non-empty `correlationId`, and that no raw
     exception/stack (`Npgsql`, `StackTrace`, `   at `) leaks to the client.

## Commands run and results

### Build
`dotnet build server/FoodHerons.sln`
- Result: **Build succeeded. 0 Warning(s), 0 Error(s).**

### Test
`dotnet test server/FoodHerons.Api.Tests/FoodHerons.Api.Tests.csproj`
- Result: **Passed! Failed: 0, Passed: 61, Skipped: 0, Total: 61.**
  (60 pre-existing + 1 new regression test.)

### Regression-guard proof
Temporarily reverted the fix (disabled `UseExceptionHandler` and made the read
catch `throw;`) and ran the new test in isolation:
- Result: **Failed! Failed: 1, Passed: 0** — the exception propagated unhandled and
  the client did not receive a clean ProblemDetails. The fix was then restored and
  the full suite re-run (61 passed). This confirms the test guards the exact
  throwing path.

## What was and wasn't verified
- Verified (in-process): the empty-connection-string fault now returns a clean,
  correlated 500 ProblemDetails instead of a leaked raw 500; all unit tests pass.
- Not verified (no live DB): the 201 Created success path against a real Postgres.
  With a valid `ConnectionStrings__Postgres` the same code path persists and
  returns 201; the operational fix is to supply that connection string.
