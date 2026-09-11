using Api.Problems;
using static Api.Accounts.AccountsProblemResults;

namespace Api.Accounts;

/// <summary>
/// Marker metadata that <see cref="RequireAccountAccessEndpointFilterExtensions.RequireAccountAccess"/>
/// attaches to an endpoint, and that <see cref="RequireAccountAccessMiddleware"/> looks for on
/// the routed endpoint before any handler (or its parameter binding) runs.
/// </summary>
public sealed class RequireAccountAccessMetadata
{
    public static readonly RequireAccountAccessMetadata Instance = new();

    private RequireAccountAccessMetadata()
    {
    }
}

/// <summary>
/// Tags a <c>{accountId}</c> route for <see cref="RequireAccountAccessMiddleware"/> and declares
/// the two problem-response shapes it can short-circuit with. The single call site every
/// account-scoped route (Scheduling, Notes, Consent, Patients, DevicePairing, VoiceEnrollment,
/// Recovery, ProfessionalVerification/submit) needs instead of a copy-pasted guard plus a
/// copy-pasted pair of <c>.Produces</c> calls (S09-05).
/// </summary>
public static class RequireAccountAccessEndpointFilterExtensions
{
    public static RouteHandlerBuilder RequireAccountAccess(this RouteHandlerBuilder builder) =>
        builder
            .WithMetadata(RequireAccountAccessMetadata.Instance)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json");
}

/// <summary>
/// Registered once in the request pipeline, right after routing has selected an endpoint and
/// before that endpoint runs -- so strictly before Minimal API's own parameter binding (route
/// values, query, body). An <see cref="Microsoft.AspNetCore.Http.IEndpointFilter"/> cannot give
/// this guarantee: it only runs once binding has already succeeded, so a structurally malformed
/// body (e.g. invalid JSON) would reach the framework's own bad-request handling before any
/// filter ever saw the request (S09-05 ronda 2, reviewer-lang finding).
/// </summary>
public sealed class RequireAccountAccessMiddleware(RequestDelegate next, ISessionTokenIssuer sessionTokenIssuer)
{
    private const string BearerPrefix = "Bearer ";

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.GetEndpoint()?.Metadata.GetMetadata<RequireAccountAccessMetadata>() is null)
        {
            await next(context);
            return;
        }

        if (!TryGetAccountIdRouteValue(context, out var accountId))
        {
            throw new InvalidOperationException(
                "RequireAccountAccess() requires the mapped route to declare a {accountId:guid} segment.");
        }

        var authorizationHeader = context.Request.Headers.Authorization.ToString();
        if (authorizationHeader.Length == 0 || !authorizationHeader.StartsWith(BearerPrefix, StringComparison.Ordinal))
        {
            await AccessTokenUnauthorizedProblem(context).ExecuteAsync(context);
            return;
        }

        var accessToken = authorizationHeader[BearerPrefix.Length..];
        if (sessionTokenIssuer.ValidateAccess(accessToken) is not { } tokenAccountId)
        {
            await AccessTokenUnauthorizedProblem(context).ExecuteAsync(context);
            return;
        }

        if (tokenAccountId != accountId)
        {
            await ForbiddenProblem().ExecuteAsync(context);
            return;
        }

        await next(context);
    }

    // RouteValues["accountId"] is null when the key is absent, and the `as` cast folds "absent"
    // and "present but not a string" into the same null Guid.TryParse already treats as failure
    // -- one branch (TryParse succeeded or not) instead of three.
    private static bool TryGetAccountIdRouteValue(HttpContext context, out Guid accountId) =>
        Guid.TryParse(context.Request.RouteValues["accountId"] as string, out accountId);
}
