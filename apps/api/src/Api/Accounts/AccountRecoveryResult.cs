namespace Api.Accounts;

public enum AccountRecoveryFailureReason
{
    InvalidRecoveryPhrase,
}

public sealed class AccountRecoveryResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public AccountRecoveryFailureReason? FailureReason { get; init; }

    public TwoFactorRequirement TwoFactorRequirement { get; init; }

    public string? TwoFactorTicket { get; init; }

    public SessionTokenPair? Session { get; init; }

    public static AccountRecoveryResult Success(Account account, string? twoFactorTicket = null, SessionTokenPair? session = null) =>
        new()
        {
            Succeeded = true,
            Account = account,
            TwoFactorRequirement = TwoFactorPolicy.Determine(account),
            TwoFactorTicket = twoFactorTicket,
            Session = session,
        };

    public static AccountRecoveryResult Failure(AccountRecoveryFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
