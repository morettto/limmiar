namespace Api.Accounts;

/// <summary>
/// Cadastro por e-mail (ADR-S02-02): the client derives <see cref="PasswordVerifier"/>
/// locally (Argon2id -- see packages/crypto) and this is the ONLY password-shaped field
/// this contract accepts. There is deliberately no "password"/"senha" property anywhere
/// in this file -- see Api.Tests/Contracts/AuthRequestContractsTests for the guard test
/// that keeps it that way.
/// </summary>
public sealed record RegisterRequest(string Email, byte[] PasswordVerifier, AccountRole Role);

/// <summary>
/// <see cref="TwoFactorTicket"/> is the opaque ticket the TOTP begin/confirm/challenge
/// endpoints require as proof this response's caller is this account (security-review
/// fix) -- null when <see cref="TwoFactorRequirement"/> is
/// <see cref="TwoFactorRequirement.NotApplicable"/>. <see cref="AccessToken"/>/
/// <see cref="RefreshToken"/>/<see cref="AccessTokenExpiresAt"/> (Spec S02, ticket
/// S02-08) are the session pair, present only when this call actually completed a login --
/// i.e. exactly when <see cref="TwoFactorTicket"/> is null.
/// </summary>
public sealed record RegisterResponse(
    Guid Id,
    string Email,
    AccountRole Role,
    TwoFactorRequirement TwoFactorRequirement,
    string? TwoFactorTicket = null,
    string? AccessToken = null,
    string? RefreshToken = null,
    DateTimeOffset? AccessTokenExpiresAt = null);
