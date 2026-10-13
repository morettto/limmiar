namespace Api.Accounts;

public interface ISessionTokenIssuer
{
    SessionTokenPair IssuePair(Guid accountId);

    RefreshSessionResult Refresh(string refreshToken);

    AccessSession? ValidateAccess(string accessToken);

    /// <summary>Revokes the token's family and returns its session, or null for an unknown token.</summary>
    AccessSession? Revoke(string refreshToken);
}
