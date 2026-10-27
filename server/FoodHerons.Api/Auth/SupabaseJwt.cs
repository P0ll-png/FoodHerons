using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

namespace FoodHerons.Api.Auth;

/// <summary>
/// Configures Supabase JWT (Bearer) validation.
///
/// Default mode is asymmetric JWKS: the OIDC metadata/JWKS are fetched from
/// <c>{Supabase:Url}/auth/v1</c>. When <c>Supabase:JwtSecret</c> is present the
/// service switches to legacy HS256 validation with that shared secret.
///
/// This configures WITHOUT throwing when no secret is set (so the service builds
/// and runs locally with no live Supabase secret). Issuer = {Supabase:Url}/auth/v1,
/// audience = 'authenticated' (overridable via config); signature + lifetime checked.
/// </summary>
public static class SupabaseJwt
{
    public static IServiceCollection AddSupabaseJwt(this IServiceCollection services, IConfiguration config)
    {
        var url = config["Supabase:Url"]?.TrimEnd('/') ?? string.Empty;
        var issuer = config["Supabase:Issuer"];
        if (string.IsNullOrWhiteSpace(issuer) && !string.IsNullOrWhiteSpace(url))
            issuer = $"{url}/auth/v1";

        var audience = config["Supabase:Audience"];
        if (string.IsNullOrWhiteSpace(audience))
            audience = "authenticated";

        var jwtSecret = config["Supabase:JwtSecret"];

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.MapInboundClaims = false;

                var validation = new TokenValidationParameters
                {
                    ValidateIssuer = !string.IsNullOrWhiteSpace(issuer),
                    ValidIssuer = issuer,
                    ValidateAudience = true,
                    ValidAudience = audience,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    NameClaimType = "sub",
                };

                if (!string.IsNullOrWhiteSpace(jwtSecret))
                {
                    // Legacy HS256 shared-secret mode.
                    validation.IssuerSigningKey =
                        new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret));
                }
                else if (!string.IsNullOrWhiteSpace(url))
                {
                    // Asymmetric JWKS mode: discover keys from the Supabase auth endpoint.
                    options.MetadataAddress = $"{url}/auth/v1/.well-known/openid-configuration";
                }

                options.TokenValidationParameters = validation;
            });

        services.AddAuthorization();
        return services;
    }
}

/// <summary>Helpers to read identity claims from a validated Supabase principal.</summary>
public static class SupabasePrincipal
{
    /// <summary>The authenticated user id (JWT <c>sub</c>), or null if absent.</summary>
    public static Guid? GetUserId(this ClaimsPrincipal principal)
    {
        var sub = principal.FindFirst("sub")?.Value
                  ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    /// <summary>
    /// The user's role from <c>app_metadata.role</c> (Supabase puts the role there),
    /// falling back to a top-level <c>role</c>/<c>user_role</c> claim. Null if absent.
    /// </summary>
    public static string? GetRole(this ClaimsPrincipal principal)
    {
        var appMetadata = principal.FindFirst("app_metadata")?.Value;
        if (!string.IsNullOrWhiteSpace(appMetadata))
        {
            try
            {
                using var doc = JsonDocument.Parse(appMetadata);
                if (doc.RootElement.ValueKind == JsonValueKind.Object
                    && doc.RootElement.TryGetProperty("role", out var roleEl)
                    && roleEl.ValueKind == JsonValueKind.String)
                {
                    return roleEl.GetString();
                }
            }
            catch (JsonException)
            {
                // Fall through to the flat claim.
            }
        }

        return principal.FindFirst("user_role")?.Value
               ?? principal.FindFirst("role")?.Value;
    }
}
