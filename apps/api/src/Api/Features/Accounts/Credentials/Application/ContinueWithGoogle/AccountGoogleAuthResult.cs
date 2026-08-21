namespace Api.Accounts;

public enum AccountGoogleAuthFailureReason
{
    InvalidGoogleToken,
}

public sealed class AccountGoogleAuthResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public bool IsNewAccount { get; init; }

    public AccountGoogleAuthFailureReason? FailureReason { get; init; }

    public TwoFactorRequirement TwoFactorRequirement { get; init; }

    public string? TwoFactorTicket { get; init; }

    public SessionTokenPair? Session { get; init; }

    public static AccountGoogleAuthResult Success(Account account, bool isNewAccount, string? twoFactorTicket = null, SessionTokenPair? session = null) =>
        new()
        {
            Succeeded = true,
            Account = account,
            IsNewAccount = isNewAccount,
            TwoFactorRequirement = TwoFactorPolicy.Determine(account),
            TwoFactorTicket = twoFactorTicket,
            Session = session,
        };

    public static AccountGoogleAuthResult Failure(AccountGoogleAuthFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
