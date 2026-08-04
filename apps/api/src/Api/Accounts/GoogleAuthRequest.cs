namespace Api.Accounts;

/// <summary>
/// <see cref="RequestedRole"/> only takes effect when this is the e-mail's first sign-in
/// (a brand-new account gets created with it); when the e-mail already has an account,
/// its existing role is used instead and this field is ignored (ADR-S02-01 -- "Google
/// resolve o papel sozinho").
/// </summary>
public sealed record GoogleAuthRequest(string IdToken, AccountRole RequestedRole);

public sealed record GoogleAuthResponse(Guid Id, string Email, AccountRole Role, bool IsNewAccount);
