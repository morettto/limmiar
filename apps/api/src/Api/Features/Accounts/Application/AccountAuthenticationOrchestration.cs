namespace Api.Accounts;

// Shared by every use case that can issue a two-factor ticket or a session (Credentials,
// Recovery) -- kept here once instead of duplicated per handler. Callers compute
// TwoFactorPolicy.Determine(account) exactly once and pass it in here (S08-28): these two
// helpers used to each call Determine themselves, so one result construction evaluated the
// same policy three times.
internal static class AccountAuthenticationOrchestration
{
    internal static string? IssueTwoFactorTicketIfRequired(Account account, TwoFactorRequirement requirement, ITwoFactorTicketIssuer twoFactorTicketIssuer) =>
        requirement == TwoFactorRequirement.NotApplicable
            ? null
            : twoFactorTicketIssuer.Issue(account.Id);

    internal static SessionTokenPair? IssueSessionIfNoTwoFactorPending(Account account, TwoFactorRequirement requirement, ISessionTokenIssuer sessionTokenIssuer) =>
        requirement == TwoFactorRequirement.NotApplicable
            ? sessionTokenIssuer.IssuePair(account.Id)
            : null;
}
