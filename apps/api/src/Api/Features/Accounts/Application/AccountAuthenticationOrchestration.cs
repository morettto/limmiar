namespace Api.Accounts;

// Shared by every use case that can issue a two-factor ticket or a session (Credentials,
// MagicLink, Recovery) -- kept here once instead of duplicated per handler.
internal static class AccountAuthenticationOrchestration
{
    internal static string? IssueTwoFactorTicketIfRequired(Account account, ITwoFactorTicketIssuer twoFactorTicketIssuer) =>
        TwoFactorPolicy.Determine(account) == TwoFactorRequirement.NotApplicable
            ? null
            : twoFactorTicketIssuer.Issue(account.Id);

    internal static SessionTokenPair? IssueSessionIfNoTwoFactorPending(Account account, ISessionTokenIssuer sessionTokenIssuer) =>
        TwoFactorPolicy.Determine(account) == TwoFactorRequirement.NotApplicable
            ? sessionTokenIssuer.IssuePair(account.Id)
            : null;
}
