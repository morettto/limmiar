namespace Api.Accounts;

public interface ISessionTokenIssuer
{
    SessionTokenPair IssuePair(Guid accountId);

    RefreshSessionResult Refresh(string refreshToken);

    Guid? ValidateAccess(string accessToken);
}
