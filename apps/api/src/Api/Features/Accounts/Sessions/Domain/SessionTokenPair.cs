namespace Api.Accounts;

public sealed record SessionTokenPair(
    string AccessToken,
    string RefreshToken,
    DateTimeOffset AccessTokenExpiresAt,
    DateTimeOffset RefreshTokenExpiresAt);

/// <summary>The account a token belongs to and its session family -- the audit trail's device.</summary>
public sealed record AccessSession(Guid AccountId, Guid SessionId);
