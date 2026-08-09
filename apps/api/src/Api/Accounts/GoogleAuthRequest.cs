namespace Api.Accounts;

/// <summary>
/// <see cref="RequestedRole"/> only takes effect when this is the e-mail's first sign-in
/// (a brand-new account gets created with it); when the e-mail already has an account,
/// its existing role is used instead and this field is ignored (ADR-S02-01 -- "Google
/// resolve o papel sozinho").
/// </summary>
public sealed record GoogleAuthRequest(string IdToken, AccountRole RequestedRole);

/// <summary>
/// <see cref="TwoFactorTicket"/> is the opaque ticket the TOTP begin/confirm/challenge
/// endpoints require as proof this response's caller is this account (security-review
/// fix) -- null when <see cref="TwoFactorRequirement"/> is
/// <see cref="TwoFactorRequirement.NotApplicable"/>. <see cref="AccessToken"/>/
/// <see cref="RefreshToken"/>/<see cref="AccessTokenExpiresAt"/> (Spec S02, ticket
/// S02-08) are the session pair, present only when this call actually completed a login --
/// i.e. exactly when <see cref="TwoFactorTicket"/> is null.
/// </summary>
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
