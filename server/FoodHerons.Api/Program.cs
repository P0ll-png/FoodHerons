using FoodHerons.Api.Auth;
using FoodHerons.Api.Data;
using FoodHerons.Api.Endpoints;
using FoodHerons.Api.Services;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

const string CorsPolicy = "frontend";

// Fail fast on a missing/empty service-role connection string instead of letting
// every POST /api/orders crash on its first DB call. The test host runs with no
// live DB, so skip the throw under the "Testing" environment.
var postgres = builder.Configuration.GetConnectionString("Postgres");
if (string.IsNullOrWhiteSpace(postgres) && !builder.Environment.IsEnvironment("Testing"))
{
    throw new InvalidOperationException(
        "Missing Postgres connection string. Set 'ConnectionStrings:Postgres' " +
        "(env 'ConnectionStrings__Postgres') via dotnet user-secrets or environment " +
        "variables before starting the API.");
}

// ---- Services --------------------------------------------------------------
builder.Services.AddSupabaseJwt(builder.Configuration);

// Dev frontend origin from config so prod can override (default Vite port 5173).
var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
                  ?? ["http://localhost:5173"];
builder.Services.AddCors(options =>
    options.AddPolicy(CorsPolicy, policy =>
        policy.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddProblemDetails();
builder.Services.AddSingleton<OrderService>();

// Npgsql data source from the service-role connection string. Registered even
// when empty so the app builds/runs with no live DB (connections open lazily).
builder.Services.AddSingleton(sp =>
{
    var connectionString = builder.Configuration.GetConnectionString("Postgres");
    return new NpgsqlDataSourceBuilder(connectionString ?? string.Empty).Build();
});
builder.Services.AddSingleton<Db>();

var app = builder.Build();

// ---- Pipeline --------------------------------------------------------------
// Global safety net: any unhandled exception becomes a clean 500 ProblemDetails
// with a correlationId (matching OrdersEndpoints.ServerError) instead of leaking.
app.UseExceptionHandler(errorApp => errorApp.Run(async httpContext =>
{
    var feature = httpContext.Features.Get<IExceptionHandlerFeature>();
    var correlationId = httpContext.TraceIdentifier;

    var logger = httpContext.RequestServices
        .GetRequiredService<ILoggerFactory>()
        .CreateLogger("UnhandledException");
    logger.LogError(feature?.Error,
        "Unhandled exception. correlationId={CorrelationId} path={Path}",
        correlationId, httpContext.Request.Path);

    var problem = new ProblemDetails
    {
        Status = StatusCodes.Status500InternalServerError,
        Title = "An unexpected error occurred.",
    };
    problem.Extensions["code"] = "INTERNAL";
    problem.Extensions["correlationId"] = correlationId;

    httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
    httpContext.Response.ContentType = "application/problem+json";
    await httpContext.Response.WriteAsJsonAsync(problem);
}));

app.UseCors(CorsPolicy);
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGroup("/api")
    .RequireAuthorization()
    .MapOrderEndpoints();

app.Run();

/// <summary>Exposed so the test host / WebApplicationFactory can reference the entry point.</summary>
public partial class Program;
