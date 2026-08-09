namespace Api.Accounts;

/// <summary>
/// E-mail/verifier login (ADR-S02-02). Same "no plaintext password field" contract as
/// <see cref="RegisterRequest"/> -- see Api.Tests/Contracts/AuthRequestContractsTests.
/// </summary>
public sealed record LoginRequest(string Email, byte[] PasswordVerifier);

/// <summary>
/// <see cref="TwoFactorTicket"/> is the opaque ticket the TOTP begin/confirm/challenge
/// endpoints require as proof this response's caller is this account (security-review
/// fix) -- null when <see cref="TwoFactorRequirement"/> is
/// <see cref="TwoFactorRequirement.NotApplicable"/>. <see cref="AccessToken"/>/
/// <see cref="RefreshToken"/>/<see cref="AccessTokenExpiresAt"/> (Spec S02, ticket
/// S02-08) are the session pair, present only when this call actually completed a login --
/// i.e. exactly when <see cref="TwoFactorTicket"/> is null.
/// </summary>
public sealed record LoginResponse(
    Guid Id,
    string Email,
    AccountRole Role,
    TwoFactorRequirement TwoFactorRequirement,
    string? TwoFactorTicket = null,
    string? AccessToken = null,
    string? RefreshToken = null,
    DateTimeOffset? AccessTokenExpiresAt = null);
