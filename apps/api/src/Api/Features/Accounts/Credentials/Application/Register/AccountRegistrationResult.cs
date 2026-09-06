using static Api.Accounts.AccountAuthenticationOrchestration;

namespace Api.Accounts;

public enum AccountRegistrationFailureReason
{
    EmailAlreadyRegistered,
}

/// <remarks>
/// S08-28 ronda 3: a ronda 2 tinha dado a <c>Success</c> um <c>TwoFactorRequirement</c> já
/// calculado por parâmetro, e as propriedades eram <c>{ get; init; }</c> públicas -- um
/// `new AccountRegistrationResult { ... }` fora daqui compilava e podia gravar um requisito
/// incoerente com a conta. Construtor privado, propriedades sem <c>init</c>, e <see cref="Success"/>
/// volta a derivar o requisito da <see cref="Account"/> -- é impossível construir um resultado
/// com requisito incoerente com a conta que vai no mesmo objeto.
/// </remarks>
public sealed class AccountRegistrationResult
{
    public bool Succeeded { get; }

    public Account? Account { get; }

    public AccountRegistrationFailureReason? FailureReason { get; }

    public TwoFactorRequirement TwoFactorRequirement { get; }

    public string? TwoFactorTicket { get; }

    public SessionTokenPair? Session { get; }

    private AccountRegistrationResult(
        bool succeeded, Account? account, AccountRegistrationFailureReason? failureReason,
        TwoFactorRequirement twoFactorRequirement, string? twoFactorTicket, SessionTokenPair? session)
    {
        Succeeded = succeeded;
        Account = account;
        FailureReason = failureReason;
        TwoFactorRequirement = twoFactorRequirement;
        TwoFactorTicket = twoFactorTicket;
        Session = session;
    }

    public static AccountRegistrationResult Success(Account account, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    {
        var requirement = TwoFactorPolicy.Determine(account);
        return new(
            succeeded: true, account, failureReason: null, requirement,
            IssueTwoFactorTicketIfRequired(account, requirement, twoFactorTicketIssuer),
            IssueSessionIfNoTwoFactorPending(account, requirement, sessionTokenIssuer));
    }

    public static AccountRegistrationResult Failure(AccountRegistrationFailureReason reason) =>
        new(succeeded: false, account: null, reason, twoFactorRequirement: default, twoFactorTicket: null, session: null);
}
