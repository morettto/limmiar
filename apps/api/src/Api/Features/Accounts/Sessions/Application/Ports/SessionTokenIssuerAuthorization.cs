using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using static Api.Accounts.AccountsProblemResults;

namespace Api.Accounts;

public static class SessionTokenIssuerAuthorization
{
    private const string BearerPrefix = "Bearer ";

    public static bool IsAuthorizedForAccount(string? authorizationHeader, Guid accountId, ISessionTokenIssuer sessionTokenIssuer)
    {
        if (authorizationHeader is null || !authorizationHeader.StartsWith(BearerPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        var accessToken = authorizationHeader[BearerPrefix.Length..];
        return sessionTokenIssuer.ValidateAccess(accessToken) == accountId;
    }

    // S09-03 (cópia literal de 2420121, fora desta base -- ver .harness/S11-04-forma.md §1):
    // null = autorizado; 401 sem header/"Bearer "/token inválido; 403 token válido de outra
    // conta (RFC 9110). Usado só pelos endpoints novos deste ticket (KeyPair, PatientLinks) --
    // os 20 chamadores existentes de IsAuthorizedForAccount continuam intocados, para não
    // alargar o âmbito desta fatia.
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
