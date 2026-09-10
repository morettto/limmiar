namespace Api.Accounts;

public static class SessionTokenIssuerAuthorization
{
    private const string BearerPrefix = "Bearer ";

    public static bool IsAuthorizedForAccount(string? authorizationHeader, Guid accountId, ISessionTokenIssuer sessionTokenIssuer) =>
        AuthorizeForAccount(authorizationHeader, accountId, sessionTokenIssuer) == AccountAuthorizationOutcome.Authorized;

    /// <summary>Unauthorized and ForbiddenOtherAccount both fail IsAuthorizedForAccount above (401). Only
    /// ListScheduledSessions calls this directly, to split the two per RFC 9110 §15.5.2 vs §15.5.4.</summary>
    public static AccountAuthorizationOutcome AuthorizeForAccount(string? authorizationHeader, Guid accountId, ISessionTokenIssuer sessionTokenIssuer)
    {
        if (authorizationHeader is null || !authorizationHeader.StartsWith(BearerPrefix, StringComparison.Ordinal))
        {
            return AccountAuthorizationOutcome.Unauthorized;
        }

        var accessToken = authorizationHeader[BearerPrefix.Length..];
        if (sessionTokenIssuer.ValidateAccess(accessToken) is not { } tokenAccountId)
        {
            return AccountAuthorizationOutcome.Unauthorized;
        }

        return tokenAccountId == accountId ? AccountAuthorizationOutcome.Authorized : AccountAuthorizationOutcome.ForbiddenOtherAccount;
    }
}

public enum AccountAuthorizationOutcome
{
    Unauthorized,
    ForbiddenOtherAccount,
    Authorized,
}
