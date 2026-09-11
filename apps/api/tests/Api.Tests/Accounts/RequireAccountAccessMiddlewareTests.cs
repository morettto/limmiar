using Api.Accounts;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Tests.Accounts;

/// <summary>
/// Unit-level proof of <see cref="RequireAccountAccessMiddleware"/>: the middleware itself
/// decides 401/403 straight off <see cref="HttpContext"/>'s <see cref="RouteEndpoint"/>,
/// independent of any route/handler -- closed by default off the route pattern's
/// <c>accountId</c> parameter, not an opt-in marker (S09-07). Integration tests
/// (Scheduling/Notes/Consent/Patients/etc. *EndpointsTests.cs, plus
/// RequireAccountAccessCoverageTests) prove it is actually wired into the pipeline ahead of
/// every real route, including ahead of body binding.
/// </summary>
public sealed class RequireAccountAccessMiddlewareTests
{
    private static readonly Guid RouteAccountId = Guid.NewGuid();
    private const string AccountIdRoutePattern = "/accounts/{accountId:guid}/x";

    [Fact]
    public async Task InvokeAsync_WithRouteWithoutAccountIdParameter_SkipsStraightToNext()
    {
        var (middleware, context, nextCalled) = CreateContext(
            routePattern: "/health", authorizationHeader: null, new StubSessionTokenIssuer(RouteAccountId),
            includeAccountIdRouteValue: false);

        await middleware.InvokeAsync(context);

        Assert.True(nextCalled());
        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
    }

    /// <summary>The 3 TOTP routes and the professional-verification decision route opt out because they authorize a different way (two-factor ticket / X-Staff-Api-Key) -- everything else with {accountId} is protected with no per-route opt-in.</summary>
    [Fact]
    public async Task InvokeAsync_WithAllowWithoutAccountTokenMetadata_SkipsStraightToNext()
    {
        var (middleware, context, nextCalled) = CreateContext(
            AccountIdRoutePattern, authorizationHeader: null, new StubSessionTokenIssuer(RouteAccountId),
            allowWithoutAccountToken: true);

        await middleware.InvokeAsync(context);

        Assert.True(nextCalled());
        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
    }

    [Fact]
    public async Task InvokeAsync_WithoutAuthorizationHeader_Returns401AndSendsWwwAuthenticateAndSkipsNext()
    {
        var (middleware, context, nextCalled) = CreateContext(
            AccountIdRoutePattern, authorizationHeader: null, new StubSessionTokenIssuer(RouteAccountId));

        await middleware.InvokeAsync(context);

        Assert.False(nextCalled());
        Assert.Equal(StatusCodes.Status401Unauthorized, context.Response.StatusCode);
        Assert.Equal("Bearer", context.Response.Headers.WWWAuthenticate.ToString());
    }

    [Fact]
    public async Task InvokeAsync_WithHeaderMissingBearerPrefix_Returns401()
    {
        var (middleware, context, nextCalled) = CreateContext(
            AccountIdRoutePattern, "Token abc", new StubSessionTokenIssuer(RouteAccountId));

        await middleware.InvokeAsync(context);

        Assert.False(nextCalled());
        Assert.Equal(StatusCodes.Status401Unauthorized, context.Response.StatusCode);
    }

    /// <summary>RFC 9110 SS11.1: the auth-scheme token ("Bearer") is compared case-insensitively -- a client that sends "bearer" in lowercase is not malformed.</summary>
    [Fact]
    public async Task InvokeAsync_WithLowercaseBearerPrefixAndValidToken_CallsNext()
    {
        var (middleware, context, nextCalled) = CreateContext(
            AccountIdRoutePattern, "bearer some-token", new StubSessionTokenIssuer(RouteAccountId));

        await middleware.InvokeAsync(context);

        Assert.True(nextCalled());
    }

    [Fact]
    public async Task InvokeAsync_WithTokenThatDoesNotResolve_Returns401()
    {
        var (middleware, context, nextCalled) = CreateContext(
            AccountIdRoutePattern, "Bearer some-token", new StubSessionTokenIssuer(resolvesTo: null));

        await middleware.InvokeAsync(context);

        Assert.False(nextCalled());
        Assert.Equal(StatusCodes.Status401Unauthorized, context.Response.StatusCode);
    }

    [Fact]
    public async Task InvokeAsync_WithTokenForDifferentAccount_Returns403AndSkipsNext()
    {
        var otherAccountId = Guid.NewGuid();
        var (middleware, context, nextCalled) = CreateContext(
            AccountIdRoutePattern, "Bearer some-token", new StubSessionTokenIssuer(otherAccountId));

        await middleware.InvokeAsync(context);

        Assert.False(nextCalled());
        Assert.Equal(StatusCodes.Status403Forbidden, context.Response.StatusCode);
    }

    [Fact]
    public async Task InvokeAsync_WithTokenForMatchingAccount_CallsNext()
    {
        var (middleware, context, nextCalled) = CreateContext(
            AccountIdRoutePattern, "Bearer some-token", new StubSessionTokenIssuer(RouteAccountId));

        await middleware.InvokeAsync(context);

        Assert.True(nextCalled());
    }

    /// <summary>A route pattern can declare {accountId} without the :guid constraint (a future mistake, since every real route pins it); the missing/unparseable route value must fail closed (403) rather than throw a 500.</summary>
    [Fact]
    public async Task InvokeAsync_WithAccountIdParameterButNoRouteValue_Returns403FailingClosed()
    {
        var (middleware, context, nextCalled) = CreateContext(
            AccountIdRoutePattern, "Bearer some-token", new StubSessionTokenIssuer(RouteAccountId),
            includeAccountIdRouteValue: false);

        await middleware.InvokeAsync(context);

        Assert.False(nextCalled());
        Assert.Equal(StatusCodes.Status403Forbidden, context.Response.StatusCode);
    }

    private static (RequireAccountAccessMiddleware Middleware, DefaultHttpContext Context, Func<bool> NextCalled) CreateContext(
        string routePattern,
        string? authorizationHeader,
        ISessionTokenIssuer sessionTokenIssuer,
        bool allowWithoutAccountToken = false,
        bool includeAccountIdRouteValue = true)
    {
        var services = new ServiceCollection();
        services.AddSingleton<Microsoft.Extensions.Logging.ILoggerFactory>(NullLoggerFactory.Instance);
        var httpContext = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
        };
        httpContext.Response.Body = new MemoryStream();

        var metadata = allowWithoutAccountToken
            ? new EndpointMetadataCollection(AllowWithoutAccountTokenMetadata.Instance)
            : EndpointMetadataCollection.Empty;

        var endpoint = new RouteEndpoint(
            requestDelegate: _ => Task.CompletedTask,
            routePattern: RoutePatternFactory.Parse(routePattern),
            order: 0,
            metadata: metadata,
            displayName: "test-endpoint");
        httpContext.SetEndpoint(endpoint);

        if (includeAccountIdRouteValue)
        {
            httpContext.Request.RouteValues["accountId"] = RouteAccountId.ToString();
        }

        if (authorizationHeader is not null)
        {
            httpContext.Request.Headers.Authorization = authorizationHeader;
        }

        var nextCalled = false;
        RequestDelegate next = _ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        };

        return (new RequireAccountAccessMiddleware(next, sessionTokenIssuer), httpContext, () => nextCalled);
    }

    private sealed class StubSessionTokenIssuer(Guid? resolvesTo) : ISessionTokenIssuer
    {
        public SessionTokenPair IssuePair(Guid accountId) => throw new NotSupportedException("not needed by these tests");

        public RefreshSessionResult Refresh(string refreshToken) => throw new NotSupportedException("not needed by these tests");

        public Guid? ValidateAccess(string accessToken) => resolvesTo;
    }
}
