namespace Api.Accounts;

public static class TwoFactorPolicy
{
    public static TwoFactorRequirement Determine(Account account) =>
        account.Role != AccountRole.Professional
            ? TwoFactorRequirement.NotApplicable
            : account.TotpEnabledAt is null
                ? TwoFactorRequirement.SetupRequired
                : TwoFactorRequirement.ChallengeRequired;
}
