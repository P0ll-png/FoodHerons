using FoodHerons.Api.Auth;
using FoodHerons.Api.Data;
using FoodHerons.Api.Endpoints;
using FoodHerons.Api.Services;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

const string CorsPolicy = "frontend";

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
