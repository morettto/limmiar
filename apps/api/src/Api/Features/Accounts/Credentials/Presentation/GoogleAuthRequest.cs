namespace Api.Accounts;

public sealed record GoogleAuthRequest(string IdToken, AccountRole RequestedRole);

public sealed record GoogleAuthResponse(
    Guid Id,
    string Email,
    AccountRole Role,
    bool IsNewAccount,
    TwoFactorRequirement TwoFactorRequirement,
    string? TwoFactorTicket = null,
    string? AccessToken = null,
    string? RefreshToken = null,
    DateTimeOffset? AccessTokenExpiresAt = null);
