using FoodHerons.Api.Auth;
using FoodHerons.Api.Data;
using FoodHerons.Api.Endpoints;
using FoodHerons.Api.Services;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);

const string CorsPolicy = "frontend";

// Fail fast on missing Supabase REST configuration instead of letting every
// POST /api/orders crash on its first HTTPS call. The test host runs with no
// live config, so skip the throw under the "Testing" environment.
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

// Typed HttpClient for the Supabase-backed data layer. BaseAddress is set only
// when Supabase:Url is non-empty (composing the PostgREST /rest/v1/ root) and
// the apikey/Authorization headers are added only when the service-role key is
// non-empty, so absent/empty config never throws at registration; an unconfigured
// client throws at send time, which the endpoint try/catch turns into a clean 500.
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
