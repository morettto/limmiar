using static Api.Accounts.AccountAuthenticationOrchestration;

namespace Api.Accounts;

public enum AccountRecoveryFailureReason
{
    InvalidRecoveryPhrase,
}

/// <remarks>
/// S08-28 ronda 3: mesmo invariante de <see cref="AccountRegistrationResult"/> -- construtor
/// privado, propriedades sem <c>init</c>, <see cref="Success"/> deriva o requisito da conta em
/// vez de o receber por parâmetro.
/// </remarks>
public sealed class AccountRecoveryResult
{
    public bool Succeeded { get; }

    public Account? Account { get; }

    public AccountRecoveryFailureReason? FailureReason { get; }

    public TwoFactorRequirement TwoFactorRequirement { get; }

    public string? TwoFactorTicket { get; }

    public SessionTokenPair? Session { get; }

    private AccountRecoveryResult(
        bool succeeded, Account? account, AccountRecoveryFailureReason? failureReason,
        TwoFactorRequirement twoFactorRequirement, string? twoFactorTicket, SessionTokenPair? session)
    {
        Succeeded = succeeded;
        Account = account;
        FailureReason = failureReason;
        TwoFactorRequirement = twoFactorRequirement;
        TwoFactorTicket = twoFactorTicket;
        Session = session;
    }

    public static AccountRecoveryResult Success(Account account, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    {
        var requirement = TwoFactorPolicy.Determine(account);
        return new(
            succeeded: true, account, failureReason: null, requirement,
            IssueTwoFactorTicketIfRequired(account, requirement, twoFactorTicketIssuer),
            IssueSessionIfNoTwoFactorPending(account, requirement, sessionTokenIssuer));
    }

    public static AccountRecoveryResult Failure(AccountRecoveryFailureReason reason) =>
        new(succeeded: false, account: null, reason, twoFactorRequirement: default, twoFactorTicket: null, session: null);
}
