using Api.Accounts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests.Accounts;

/// <summary>
/// Walks the <see cref="EndpointDataSource"/> of the real, fully composed app: every
/// <see cref="RouteEndpoint"/> whose pattern declares <c>accountId</c> must be either opted out
/// (<see cref="AllowWithoutAccountTokenMetadata"/> -- exactly the 3 TOTP routes plus the
/// professional-verification decision route, all four gated some other way) or carry both the
/// 401 and 403 OpenAPI responses that <c>DeclareAccountAccessOpenApiResponses()</c> stamps on
/// every route <see cref="RequireAccountAccessMiddleware"/> actually protects. A route in
/// neither bucket is a route that shipped unprotected by omission -- the B1 finding this ticket
/// closes (S09-07).
/// </summary>
public sealed class RequireAccountAccessCoverageTests
{
    private static readonly string[] ExpectedOptedOutRouteNames =
    [
        "PostAccountTotp",
        "PostAccountTotpConfirm",
        "PostAccountTotpChallenge",
        "PostProfessionalVerificationDecision",
    ];

    [Fact]
    public void EveryAccountIdRoute_IsProtectedOrExplicitlyOptedOut()
    {
        using var factory = CreateFactory();
        var endpointDataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        var accountIdRoutes = endpointDataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.Parameters.Any(p => p.Name == "accountId"))
            .ToList();

        Assert.NotEmpty(accountIdRoutes);

        var optedOut = new List<string>();
        var unprotected = new List<string>();

        foreach (var endpoint in accountIdRoutes)
        {
            var routeName = endpoint.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName ?? endpoint.DisplayName ?? "(unnamed)";

            if (endpoint.Metadata.GetMetadata<AllowWithoutAccountTokenMetadata>() is not null)
            {
                optedOut.Add(routeName);
                continue;
            }

            var statusCodes = endpoint.Metadata
                .GetOrderedMetadata<IProducesResponseTypeMetadata>()
                .Select(m => m.StatusCode)
                .ToHashSet();

            if (!statusCodes.Contains(StatusCodes.Status401Unauthorized) || !statusCodes.Contains(StatusCodes.Status403Forbidden))
            {
                unprotected.Add(routeName);
            }
        }

        Assert.Empty(unprotected);
        Assert.Equal(ExpectedOptedOutRouteNames.OrderBy(n => n), optedOut.OrderBy(n => n));
    }

    /// <summary>Direct, isolated proof of the convention itself (as opposed to the whole app's wiring above): it stamps 401/403 on an {accountId} route, leaves an opted-out {accountId} route and a route without accountId untouched.</summary>
    [Fact]
    public async Task DeclareAccountAccessOpenApiResponses_StampsOnlyProtectedAccountIdRoutes()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        await using var app = builder.Build();

        var routes = app.MapGroup("").DeclareAccountAccessOpenApiResponses();
        routes.MapGet("/accounts/{accountId:guid}/protected", () => "ok").WithName("Protected");
        routes.MapGet("/accounts/{accountId:guid}/opted-out", () => "ok").WithName("OptedOut").AllowWithoutAccountToken();
        routes.MapGet("/health", () => "ok").WithName("Health");

        await app.StartAsync();
        var endpointDataSource = app.Services.GetRequiredService<EndpointDataSource>();
        var byName = endpointDataSource.Endpoints
            .OfType<RouteEndpoint>()
            .ToDictionary(e => e.Metadata.GetMetadata<IEndpointNameMetadata>()!.EndpointName!);
        await app.StopAsync();

        Assert.True(HasBothAuthResponses(byName["Protected"]));
        Assert.False(HasBothAuthResponses(byName["OptedOut"]));
        Assert.False(HasBothAuthResponses(byName["Health"]));
    }

    private static bool HasBothAuthResponses(RouteEndpoint endpoint)
    {
        var statusCodes = endpoint.Metadata
            .GetOrderedMetadata<IProducesResponseTypeMetadata>()
            .Select(m => m.StatusCode)
            .ToHashSet();
        return statusCodes.Contains(StatusCodes.Status401Unauthorized) && statusCodes.Contains(StatusCodes.Status403Forbidden);
    }

    private static WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
            });
}
