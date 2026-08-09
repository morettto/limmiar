namespace Api.Accounts;

/// <summary>
/// A freshly (re)issued access/refresh token pair. Both tokens are opaque, random strings
/// (same <c>RandomNumberGenerator</c>-backed shape as <see cref="TwoFactorTicketIssuer"/>'s
/// tickets) -- callers must not attempt to decode or interpret either one.
/// </summary>
public sealed record SessionTokenPair(
    string AccessToken,
    string RefreshToken,
    DateTimeOffset AccessTokenExpiresAt,
    DateTimeOffset RefreshTokenExpiresAt);
