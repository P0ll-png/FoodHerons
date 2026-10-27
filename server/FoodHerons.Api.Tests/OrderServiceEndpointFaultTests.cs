using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using FoodHerons.Api.Data;
using FoodHerons.Api.Dtos;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using Xunit;

namespace FoodHerons.Api.Tests;

/// <summary>
/// Exercises the exact POST /api/orders path that was returning a raw HTTP 500.
/// The data layer talks to Supabase over HTTPS (typed HttpClient against
/// ${Supabase:Url}/rest/v1/, PostgREST GET reads + place_order/transition_order RPC
/// writes). This test injects a fault at that transport by overriding the typed Db
/// client's primary handler with a <see cref="ThrowingHandler"/>, so the first data
/// call (GetVendorAsync) throws with zero network. Asserts the global exception
/// handler + read try/catch produce a clean 500 ProblemDetails (code INTERNAL +
/// correlationId), not a leaked stack trace.
/// </summary>
public class OrderServiceEndpointFaultTests : IClassFixture<FaultWebAppFactory>
{
    private readonly FaultWebAppFactory _factory;

    public OrderServiceEndpointFaultTests(FaultWebAppFactory factory) => _factory = factory;

    [Fact]
    public async Task Place_order_db_fault_returns_clean_500_problem_details()
    {
        var client = _factory.CreateClient();

        var body = new PlaceOrderRequest(
            VendorId: "v1",
            PickupName: "Juan",
            Note: null,
            Items: new[] { new LineItemDto("tapsilog", 1) });

        var response = await client.PostAsJsonAsync("/api/orders", body);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);

        var raw = await response.Content.ReadAsStringAsync();

        using var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;

        Assert.Equal("INTERNAL", root.GetProperty("code").GetString());

        var correlationId = root.GetProperty("correlationId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(correlationId));

        // The raw exception/stack must not leak to the client.
        Assert.DoesNotContain("Npgsql", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("StackTrace", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("   at ", raw, StringComparison.Ordinal);
    }
}

/// <summary>
/// In-memory host with the "Testing" environment (the Supabase fail-fast is skipped
/// there) and a stub auth scheme that yields a <c>student</c> principal, so the
/// request passes RequireAuthorization + the student-role check and reaches the data
/// layer. The typed <see cref="Db"/> client's primary handler is replaced with a
/// <see cref="ThrowingHandler"/> so the Supabase HTTPS call fails deterministically
/// with zero network — the endpoint try/catch then yields the clean 500.
/// </summary>
public sealed class FaultWebAppFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        builder.ConfigureTestServices(services =>
        {
            services.AddAuthentication(TestAuthHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, _ => { });

            services.PostConfigure<AuthenticationOptions>(options =>
            {
                options.DefaultAuthenticateScheme = TestAuthHandler.SchemeName;
                options.DefaultChallengeScheme = TestAuthHandler.SchemeName;
            });

            // Make the fault path deterministic and network-free by overriding the
            // TYPED Db client's primary handler (not a named client — that would build
            // a different, unused client). The first data call throws, with no DNS/connect.
            services.AddHttpClient<Db>()
                .ConfigurePrimaryHttpMessageHandler(() => new ThrowingHandler());
        });
    }
}

/// <summary>An HttpMessageHandler that always throws, injecting a transport fault with zero network.</summary>
public sealed class ThrowingHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        throw new HttpRequestException("fault-test");
}

/// <summary>A no-network auth handler that always authenticates as a fixed student user.</summary>
public sealed class TestAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "TestScheme";

    public TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var claims = new[]
        {
            new Claim("sub", "11111111-1111-1111-1111-111111111111"),
            new Claim("role", "student"),
        };
        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
