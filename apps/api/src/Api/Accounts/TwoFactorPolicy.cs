namespace Api.Accounts;

/// <summary>
/// Pure policy: whether -- and at which stage -- an account must complete TOTP two-factor
/// authentication (Spec S02, ADR-S02-03/S02-04). No state of its own, same style as
/// <see cref="AccountAuthorizationGuard"/>.
/// </summary>
public static class TwoFactorPolicy
{
    /// <summary>
    /// <see cref="TwoFactorRequirement.NotApplicable"/> for any account that isn't
    /// <see cref="AccountRole.Professional"/> -- 2FA is mandatory for professionals and
    /// never applies to anyone else. For a professional account,
    /// <see cref="TwoFactorRequirement.SetupRequired"/> until it has confirmed an
    /// enrollment (<see cref="Account.TotpEnabledAt"/> set), then
    /// <see cref="TwoFactorRequirement.ChallengeRequired"/> from that point on.
    /// </summary>
    public static TwoFactorRequirement Determine(Account account) =>
        account.Role != AccountRole.Professional
            ? TwoFactorRequirement.NotApplicable
            : account.TotpEnabledAt is null
                ? TwoFactorRequirement.SetupRequired
                : TwoFactorRequirement.ChallengeRequired;
}
