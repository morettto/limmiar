using Api.Accounts;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Tests.Accounts;

/// <summary>
/// Unit-level proof of <see cref="RequireAccountAccessMiddleware"/>: the middleware itself
/// decides 401/403 straight off <see cref="HttpContext"/>, independent of any route/handler.
/// Integration tests (Scheduling/Notes/Consent/Patients/etc. *EndpointsTests.cs) prove it is
/// actually wired into the pipeline ahead of the 20 routes, including ahead of body binding.
/// </summary>
public sealed class RequireAccountAccessMiddlewareTests
{
    private static readonly Guid RouteAccountId = Guid.NewGuid();

    [Fact]
    public async Task InvokeAsync_WithoutRequireAccountAccessMetadata_SkipsStraightToNext()
    {
        var (middleware, context, nextCalled) = CreateContext(
            hasMetadata: false, authorizationHeader: null, new StubSessionTokenIssuer(RouteAccountId));

        await middleware.InvokeAsync(context);

        Assert.True(nextCalled());
        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
    }

    [Fact]
    public async Task InvokeAsync_WithoutAuthorizationHeader_Returns401AndSendsWwwAuthenticateAndSkipsNext()
    {
        var (middleware, context, nextCalled) = CreateContext(
            hasMetadata: true, authorizationHeader: null, new StubSessionTokenIssuer(RouteAccountId));

        await middleware.InvokeAsync(context);

        Assert.False(nextCalled());
        Assert.Equal(StatusCodes.Status401Unauthorized, context.Response.StatusCode);
        Assert.Equal("Bearer", context.Response.Headers.WWWAuthenticate.ToString());
    }

    [Fact]
    public async Task InvokeAsync_WithHeaderMissingBearerPrefix_Returns401()
    {
        var (middleware, context, nextCalled) = CreateContext(
            hasMetadata: true, "Token abc", new StubSessionTokenIssuer(RouteAccountId));

        await middleware.InvokeAsync(context);

        Assert.False(nextCalled());
        Assert.Equal(StatusCodes.Status401Unauthorized, context.Response.StatusCode);
    }

    [Fact]
    public async Task InvokeAsync_WithTokenThatDoesNotResolve_Returns401()
    {
        var (middleware, context, nextCalled) = CreateContext(
            hasMetadata: true, "Bearer some-token", new StubSessionTokenIssuer(resolvesTo: null));

        await middleware.InvokeAsync(context);

        Assert.False(nextCalled());
        Assert.Equal(StatusCodes.Status401Unauthorized, context.Response.StatusCode);
    }

    [Fact]
    public async Task InvokeAsync_WithTokenForDifferentAccount_Returns403AndSkipsNext()
    {
        var otherAccountId = Guid.NewGuid();
        var (middleware, context, nextCalled) = CreateContext(
            hasMetadata: true, "Bearer some-token", new StubSessionTokenIssuer(otherAccountId));

        await middleware.InvokeAsync(context);

        Assert.False(nextCalled());
        Assert.Equal(StatusCodes.Status403Forbidden, context.Response.StatusCode);
    }

    [Fact]
    public async Task InvokeAsync_WithTokenForMatchingAccount_CallsNext()
    {
        var (middleware, context, nextCalled) = CreateContext(
            hasMetadata: true, "Bearer some-token", new StubSessionTokenIssuer(RouteAccountId));

        await middleware.InvokeAsync(context);

        Assert.True(nextCalled());
    }

    /// <summary>A route tagged with RequireAccountAccess() but missing the {accountId:guid} segment is a composition bug, not a caller-facing 401/403 -- fail loud instead of silently misreporting the wrong status.</summary>
    [Fact]
    public async Task InvokeAsync_WithMetadataButNoAccountIdRouteValue_Throws()
    {
        var (middleware, context, _) = CreateContext(
            hasMetadata: true, authorizationHeader: null, new StubSessionTokenIssuer(RouteAccountId), includeAccountIdRouteValue: false);

        await Assert.ThrowsAsync<InvalidOperationException>(() => middleware.InvokeAsync(context));
    }

    private static (RequireAccountAccessMiddleware Middleware, DefaultHttpContext Context, Func<bool> NextCalled) CreateContext(
        bool hasMetadata, string? authorizationHeader, ISessionTokenIssuer sessionTokenIssuer, bool includeAccountIdRouteValue = true)
    {
        var services = new ServiceCollection();
        services.AddSingleton<Microsoft.Extensions.Logging.ILoggerFactory>(NullLoggerFactory.Instance);
        var httpContext = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
        };
        httpContext.Response.Body = new MemoryStream();

        if (hasMetadata)
        {
            var endpoint = new Endpoint(
                requestDelegate: null,
                metadata: new EndpointMetadataCollection(RequireAccountAccessMetadata.Instance),
                displayName: "test-endpoint");
            httpContext.SetEndpoint(endpoint);
        }

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
