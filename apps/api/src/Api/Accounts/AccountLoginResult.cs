namespace Api.Accounts;

public enum AccountLoginFailureReason
{
    InvalidCredentials,
}

public sealed class AccountLoginResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public AccountLoginFailureReason? FailureReason { get; init; }

    public TwoFactorRequirement TwoFactorRequirement { get; init; }

    public string? TwoFactorTicket { get; init; }

    public SessionTokenPair? Session { get; init; }

    public static AccountLoginResult Success(Account account, string? twoFactorTicket = null, SessionTokenPair? session = null) =>
        new()
        {
            Succeeded = true,
            Account = account,
            TwoFactorRequirement = TwoFactorPolicy.Determine(account),
            TwoFactorTicket = twoFactorTicket,
            Session = session,
        };

    public static AccountLoginResult Failure(AccountLoginFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
