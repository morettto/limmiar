namespace Api.Accounts;

public sealed record LoginRequest(string Email, byte[] PasswordVerifier);

public sealed record LoginResponse(
    Guid Id,
    string Email,
    AccountRole Role,
    TwoFactorRequirement TwoFactorRequirement,
    string? TwoFactorTicket = null,
    string? AccessToken = null,
    string? RefreshToken = null,
    DateTimeOffset? AccessTokenExpiresAt = null);
