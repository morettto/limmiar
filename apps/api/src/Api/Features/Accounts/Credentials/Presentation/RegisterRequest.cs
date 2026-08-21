namespace Api.Accounts;

public sealed record RegisterRequest(string Email, byte[] PasswordVerifier, AccountRole Role);

public sealed record RegisterResponse(
    Guid Id,
    string Email,
    AccountRole Role,
    TwoFactorRequirement TwoFactorRequirement,
    string? TwoFactorTicket = null,
    string? AccessToken = null,
    string? RefreshToken = null,
    DateTimeOffset? AccessTokenExpiresAt = null);
