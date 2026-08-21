using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Api.Accounts;

// AuthAccessTokenInvalid is an Accounts code, so this helper cannot live in
// Platform/Problems alongside ProblemResults without inverting the dependency.
internal static class AccountsProblemResults
{
    internal static JsonHttpResult<LimmiarProblemDetails> AccessTokenUnauthorizedProblem() =>
        ProblemResults.ProblemJson(
            StatusCodes.Status401Unauthorized,
            "Missing or invalid access token",
            AccountsProblemCodes.AuthAccessTokenInvalid);
}
