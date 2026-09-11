using Api.Problems;
using Microsoft.AspNetCore.Routing.Patterns;
using static Api.Accounts.AccountsProblemResults;

namespace Api.Accounts;

/// <summary>
/// Opt-out marker for an <c>{accountId}</c> route that is intentionally not gated by
/// <see cref="RequireAccountAccessMiddleware"/> because it authorizes a different way. Every
/// other <c>{accountId}</c> route is protected with no per-route call needed -- closed by
/// default. Attach via <see cref="AccountAccessEndpointConventions.AllowWithoutAccountToken"/>
/// and say why at the call site.
/// </summary>
public sealed class AllowWithoutAccountTokenMetadata
{
    public static readonly AllowWithoutAccountTokenMetadata Instance = new();

    private AllowWithoutAccountTokenMetadata()
    {
    }
}

/// <summary>
/// The one place that decides whether a route is covered by <see cref="RequireAccountAccessMiddleware"/>:
/// its <see cref="RoutePattern"/> declares <c>accountId</c> and it was not opted out. Both the
/// middleware (runtime 401/403) and <see cref="DeclareAccountAccessOpenApiResponses"/> (OpenAPI
/// docs) call this same check, so the two can never drift apart.
/// </summary>
public static class AccountAccessEndpointConventions
{
    /// <summary>Opts an <c>{accountId}</c> route out of <see cref="RequireAccountAccessMiddleware"/> -- only for a route that authorizes some other way (name that gate in a comment at the call site).</summary>
    public static RouteHandlerBuilder AllowWithoutAccountToken(this RouteHandlerBuilder builder) =>
        builder.WithMetadata(AllowWithoutAccountTokenMetadata.Instance);

    /// <summary>
    /// Registered once, on the app's root route group (Program.Composition.cs), so every
    /// <c>{accountId}</c> route declares the 401/403 OpenAPI responses with nothing to remember
    /// per route. Runs via <see cref="IEndpointConventionBuilder.Finally"/> so it sees the final
    /// metadata list -- including a route's own <see cref="AllowWithoutAccountToken"/> -- rather
    /// than racing it.
    /// </summary>
    public static TBuilder DeclareAccountAccessOpenApiResponses<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
    {
        builder.Finally(endpointBuilder =>
        {
            // Every endpoint mapped in this app is a Minimal API route (no controllers/hubs
            // registered), so this is always a RouteEndpointBuilder -- a direct cast fails loud
            // on a composition mistake instead of silently skipping a route's OpenAPI metadata.
            var routePattern = ((RouteEndpointBuilder)endpointBuilder).RoutePattern;
            if (!RequiresAccountAccess(routePattern, HasOptOut(endpointBuilder.Metadata)))
            {
                return;
            }

            endpointBuilder.Metadata.Add(new Microsoft.AspNetCore.Http.ProducesResponseTypeMetadata(
                StatusCodes.Status401Unauthorized, typeof(LimmiarProblemDetails), ["application/problem+json"]));
            endpointBuilder.Metadata.Add(new Microsoft.AspNetCore.Http.ProducesResponseTypeMetadata(
                StatusCodes.Status403Forbidden, typeof(LimmiarProblemDetails), ["application/problem+json"]));
        });

        return builder;
    }

    internal static bool RequiresAccountAccess(RoutePattern routePattern, bool hasOptOut) =>
        !hasOptOut && routePattern.Parameters.Any(p => p.Name == "accountId");

    private static bool HasOptOut(IList<object> metadata) =>
        metadata.Any(m => m is AllowWithoutAccountTokenMetadata);
}

/// <summary>
/// Registered once in the request pipeline, right after routing has selected an endpoint and
/// before that endpoint runs -- so strictly before Minimal API's own parameter binding (route
/// values, query, body). An <see cref="Microsoft.AspNetCore.Http.IEndpointFilter"/> cannot give
/// this guarantee: it only runs once binding has already succeeded, so a structurally malformed
/// body (e.g. invalid JSON) would reach the framework's own bad-request handling before any
/// filter ever saw the request. Protects every routed endpoint whose pattern declares
/// <c>{accountId}</c>, unless it opted out (see <see cref="AllowWithoutAccountTokenMetadata"/>) --
/// closed by default, so a new route can't ship unprotected by omission.
/// </summary>
public sealed class RequireAccountAccessMiddleware(RequestDelegate next, ISessionTokenIssuer sessionTokenIssuer)
{
    private const string BearerPrefix = "Bearer ";

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.GetEndpoint() is not RouteEndpoint endpoint
            || !AccountAccessEndpointConventions.RequiresAccountAccess(
                endpoint.RoutePattern, endpoint.Metadata.GetMetadata<AllowWithoutAccountTokenMetadata>() is not null))
        {
            await next(context);
            return;
        }

        var authorizationHeader = context.Request.Headers.Authorization.ToString();
        if (!authorizationHeader.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase)
            || sessionTokenIssuer.ValidateAccess(authorizationHeader[BearerPrefix.Length..]) is not { } tokenAccountId)
        {
            await AccessTokenUnauthorizedProblem(context).ExecuteAsync(context);
            return;
        }

        // Every {accountId} route pins it with the :guid route constraint, so routing itself
        // never selects this endpoint for a non-guid segment -- TryParse only defends a future
        // route that forgets the constraint, failing closed (403) instead of a 500.
        if (!TryGetAccountIdRouteValue(context, out var accountId) || tokenAccountId != accountId)
        {
            await ForbiddenProblem().ExecuteAsync(context);
            return;
        }

        await next(context);
    }

    private static bool TryGetAccountIdRouteValue(HttpContext context, out Guid accountId) =>
        Guid.TryParse(context.Request.RouteValues["accountId"] as string, out accountId);
}
