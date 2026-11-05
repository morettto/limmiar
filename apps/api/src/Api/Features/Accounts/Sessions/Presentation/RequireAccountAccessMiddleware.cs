using Api.Problems;
using Microsoft.AspNetCore.Routing.Patterns;
using static Api.Accounts.AccountsProblemResults;

namespace Api.Accounts;

/// <summary>Marks an account-scoped route that uses another authorization mechanism.</summary>
public sealed class AllowWithoutAccountTokenMetadata
{
    public static readonly AllowWithoutAccountTokenMetadata Instance = new();

    private AllowWithoutAccountTokenMetadata()
    {
    }
}

public static class AccountAccessEndpointConventions
{
    /// <summary>Opts an account-scoped route out when it has another authorization mechanism.</summary>
    public static RouteHandlerBuilder AllowWithoutAccountToken(this RouteHandlerBuilder builder) =>
        builder.WithMetadata(AllowWithoutAccountTokenMetadata.Instance);

    public static RouteGroupBuilder DeclareAccountAccessOpenApiResponses(this RouteGroupBuilder builder)
    {
        // RouteGroupBuilder implements IEndpointConventionBuilder explicitly, so Finally is only
        // reachable through the interface.
        IEndpointConventionBuilder conventions = builder;
        conventions.Finally(endpointBuilder =>
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
        !hasOptOut && routePattern.Parameters.Any(p => string.Equals(p.Name, "accountId", StringComparison.OrdinalIgnoreCase));

    private static bool HasOptOut(IList<object> metadata) =>
        metadata.Any(m => m is AllowWithoutAccountTokenMetadata);
}

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
            || sessionTokenIssuer.ValidateAccess(authorizationHeader[BearerPrefix.Length..]) is not { } session)
        {
            await AccessTokenUnauthorizedProblem(context).ExecuteAsync(context);
            return;
        }

        // Every {accountId} route pins it with the :guid route constraint, so routing itself
        // never selects this endpoint for a non-guid segment -- TryParse only defends a future
        // route that forgets the constraint, failing closed (403) instead of a 500.
        if (!TryGetAccountIdRouteValue(context, out var accountId) || session.AccountId != accountId)
        {
            await ForbiddenProblem().ExecuteAsync(context);
            return;
        }

        Api.Audit.AuditRecorder.Attach(context, session);
        await next(context);
    }

    private static bool TryGetAccountIdRouteValue(HttpContext context, out Guid accountId) =>
        Guid.TryParse(context.Request.RouteValues["accountId"] as string, out accountId);
}
