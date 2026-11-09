# Clean 500 ProblemDetails for the POST /api/orders DB fault

The fix addresses the reported HTTP 500 on "Confirm Pre-Order" by pinning the fault to its real cause: `PlaceOrderAsync` issued its first database call (`GetVendorAsync`) outside any `try/catch`, and `Program.cs` registered `AddProblemDetails()` but never installed a global exception handler, so an Npgsql/connection exception (triggered by an empty `ConnectionStrings:Postgres`) surfaced as a bare 500 with no body. The change wraps the place-order read calls in the same `try/catch → ServerError` pattern already used for the write, adds an `app.UseExceptionHandler(...)` outer net that emits the identical ProblemDetails shape, fails fast at startup on a missing connection string (except under the `Testing` environment), documents the required runtime secret, and adds an in-process regression test that drives the exact throwing path. This is correctly treated as an internal fault returning 500 `code=INTERNAL` with a `correlationId`, not a 4xx business condition — the existing VENDOR_CLOSED 409 branch is preserved.

Watch for: nothing blocking. The read try/catch now sits in front of the global handler, so for the place-order path the handler is a true backstop rather than the primary path exercised by the test (confirmed); the revert-proof in the verification disabled both, so the regression guard is still sound.

**Verdict**: APPROVED

## High-level view

The root cause in the plan and the diff agree: the first DB read in `PlaceOrderAsync` was unguarded and there was no global exception handler, so an unexpected exception leaked as a raw 500. The fix targets that cause directly rather than a symptom, and correctly classifies the fault as internal (500 INTERNAL) rather than inventing a spurious 4xx business code.

The error path matches the conventions already in `OrdersEndpoints.cs`. The new read `catch` block is a line-for-line mirror of the existing `InsertOrderAsync` catch — same `correlationId = http.TraceIdentifier`, same structured log, same `ServerError(http, correlationId)` return. The global handler in `Program.cs` reproduces the exact `ServerError` ProblemDetails shape (Status 500, Title "An unexpected error occurred.", `code=INTERNAL`, `correlationId`). The VENDOR_CLOSED 409 business branch stays inside the new `try` and still returns via the normal `Problem(...)` path, so a closed vendor is not misclassified as a 500.

The regression test drives the real throwing path: a stub auth scheme yields a `student` principal with a valid GUID `sub`, the body passes validation, execution reaches `GetVendorAsync`, and the empty connection string makes the command throw. It asserts 500, `code == "INTERNAL"`, a non-empty `correlationId`, and absence of `Npgsql`/`StackTrace`/`   at ` in the body. The verification documents a revert-proof (handler disabled + read catch changed to `throw;`) where the test fails, which confirms the test guards the exact regression and not an incidental path.

The connection-string fail-fast and the `.env.example` note address the operational trigger so a correctly configured deployment returns 201. These are gated on `!IsEnvironment("Testing")`, which is what lets the DB-free test host still boot.

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking action items. The one behavioral nuance (read try/catch fronting the global handler for this path) is covered by the revert-proof and is not a defect.

</details>

<details>
<summary>Details</summary>

### Root cause match: unguarded first read + no global handler

`GetVendorAsync` runs `ExecuteReaderAsync`, which opens a lazy Npgsql connection; with an empty connection string that throws. Only the later `InsertOrderAsync` write was wrapped — the two reads were not, and no `UseExceptionHandler` existed to catch what escaped. The diff puts both reads inside a `try` and installs the global handler immediately after `app.Build()`, before `UseCors`. An unconfigured DB would 500 on every order, matching the universal "clicking Confirm Pre-Order returns 500" report, so this is the cause and not a symptom. (confirmed)

The 500-vs-4xx classification matters and is correct: an empty/broken connection string carries no student-facing business meaning, so attaching a 4xx code (ITEM_UNAVAILABLE / VENDOR_CLOSED / VALIDATION) would be wrong. Mapping it to a clean 500 `INTERNAL` with a `correlationId` is exactly the internal-fault outcome the task allows. (confirmed)

### Error path matches existing conventions

The new read catch block:

```csharp
catch (Exception ex)
{
    var correlationId = http.TraceIdentifier;
    log.LogError(ex, "Place-order DB read failure. correlationId={CorrelationId} user={UserId} vendor={VendorId}",
        correlationId, userId, vendorId);
    return ServerError(http, correlationId);
}
```

is the same structure as the pre-existing `InsertOrderAsync` catch directly below it, reusing the same `ServerError` helper. The global handler independently builds a `ProblemDetails` with `Status=500`, `Title="An unexpected error occurred."`, `Extensions["code"]="INTERNAL"`, `Extensions["correlationId"]=TraceIdentifier` — byte-for-byte the shape `ServerError` produces. So whether an exception is caught at the endpoint or escapes to the outer net, the client sees one consistent contract. The VENDOR_CLOSED 409 branch remains inside the `try` and returns through `Problem(...)` before any exception path, so business rejection is not swallowed into a 500. (confirmed)

### Regression test drives the exact throwing path

`FaultWebAppFactory` sets `UseEnvironment("Testing")` (so the startup fail-fast is skipped and the empty connection string is allowed) and registers `TestAuthHandler` as the default scheme. The handler emits `sub` = a valid GUID and `role` = `student`. `GetUserId()` parses the GUID; `GetRole()` falls back to the flat `role` claim and returns `student`, so the request clears `RequireAuthorization`, the 401 check, and the student-role check, then reaches `GetVendorAsync` — which throws on the empty connection string. The DTO constructors used in the test (`PlaceOrderRequest(VendorId, PickupName, Note, Items)`, `LineItemDto("tapsilog", 1)`) match the current records, and the body passes `ValidatePlaceOrder`, so execution genuinely reaches the DB rather than short-circuiting at a 422. The assertions pin the corrected behavior: 500, `code == "INTERNAL"`, non-empty `correlationId`, and no `Npgsql`/`StackTrace`/`   at ` leak. (confirmed)

One nuance: because the read `try/catch` now fronts the global handler, the place-order path is caught at the endpoint and the test primarily asserts the endpoint behavior, with the handler as backstop. The verification's revert-proof disabled both the handler and the read catch (changed to `throw;`) and showed the test failing, which confirms the test guards the real regression across both layers rather than passing incidentally. (confirmed, per verification evidence)

### Verification evidence is complete and consistent

The evidence reports `dotnet build server/FoodHerons.sln` with 0 warnings/0 errors and `dotnet test` on the API test project with 61 passed / 0 failed (60 baseline + 1 new), plus the revert-proof. Per task instructions I did not re-run the build or suite; the evidence is internally consistent with the diff (new package `Microsoft.AspNetCore.Mvc.Testing` 10.0.0, new test file, `public partial class Program` present for `WebApplicationFactory<Program>`), and leaves no specific articulable doubt that would justify a spot-check. The honest scope note — the 201 success path was not exercised against a live Postgres — is acknowledged and appropriate, since that requires a real DB and the operational fix is supplying the connection string, which the `.env.example` note now documents. (confirmed)

</details>

<details>
<summary>File map</summary>

- `server/FoodHerons.Api/Program.cs` — adds global `UseExceptionHandler` emitting the `ServerError` ProblemDetails shape; adds startup fail-fast on empty `ConnectionStrings:Postgres` (skipped under `Testing`).
- `server/FoodHerons.Api/Endpoints/OrdersEndpoints.cs` — wraps the place-order `GetVendorAsync`/`GetMenuItemsAsync` reads in a `try/catch → ServerError`; VENDOR_CLOSED 409 branch unchanged inside the try.
- `server/FoodHerons.Api.Tests/OrderServiceEndpointFaultTests.cs` — new in-process regression test + `WebApplicationFactory` + stub auth handler driving the DB-fault path.
- `server/FoodHerons.Api.Tests/FoodHerons.Api.Tests.csproj` — adds `Microsoft.AspNetCore.Mvc.Testing` 10.0.0.
- `server/FoodHerons.Api/.env.example` — documents the required runtime `ConnectionStrings__Postgres` and the fail-fast behavior.

Full diff: `git diff HEAD~1 -- server` (commit `1a96e0b`).

</details>
