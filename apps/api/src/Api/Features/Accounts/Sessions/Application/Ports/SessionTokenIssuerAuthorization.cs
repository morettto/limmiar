using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using static Api.Accounts.AccountsProblemResults;

namespace Api.Accounts;

public static class SessionTokenIssuerAuthorization
{
    private const string BearerPrefix = "Bearer ";

    // null = autorizado; 401 sem header/"Bearer "/token inválido; 403 token válido de outra conta.
    public static JsonHttpResult<LimmiarProblemDetails>? AccountAccessProblem(string? authorizationHeader, Guid accountId, ISessionTokenIssuer sessionTokenIssuer)
    {
        if (authorizationHeader is null || !authorizationHeader.StartsWith(BearerPrefix, StringComparison.Ordinal))
        {
            return AccessTokenUnauthorizedProblem();
        }

        var accessToken = authorizationHeader[BearerPrefix.Length..];
        if (sessionTokenIssuer.ValidateAccess(accessToken) is not { } tokenAccountId)
        {
            return AccessTokenUnauthorizedProblem();
        }

        return tokenAccountId == accountId ? null : ForbiddenProblem();
    }
}
