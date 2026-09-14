using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Api.Accounts;

// AuthAccessTokenInvalid is an Accounts code, so this helper cannot live in
// Platform/Problems alongside ProblemResults without inverting the dependency.
internal static class AccountsProblemResults
{
    // WWW-Authenticate is mandatory on a 401 per RFC 9110 SS15.5.2 -- it has nowhere to live on
    // JsonHttpResult<T> itself, so it is set directly on the response here, the only place a
    // 401 for a missing/invalid access token is produced.
    internal static JsonHttpResult<LimmiarProblemDetails> AccessTokenUnauthorizedProblem(HttpContext httpContext)
    {
        httpContext.Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResults.ProblemJson(
            StatusCodes.Status401Unauthorized,
            "Missing or invalid access token",
            AccountsProblemCodes.AuthAccessTokenInvalid);
    }

    internal static JsonHttpResult<LimmiarProblemDetails> ForbiddenProblem() =>
        ProblemResults.ProblemJson(
            StatusCodes.Status403Forbidden,
            "Access token does not authorize this account",
            AccountsProblemCodes.AuthForbidden);
}
