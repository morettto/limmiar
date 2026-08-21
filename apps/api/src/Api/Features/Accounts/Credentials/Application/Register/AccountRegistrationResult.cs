namespace Api.Accounts;

public enum AccountRegistrationFailureReason
{
    EmailAlreadyRegistered,
}

public sealed class AccountRegistrationResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public AccountRegistrationFailureReason? FailureReason { get; init; }

    public TwoFactorRequirement TwoFactorRequirement { get; init; }

    public string? TwoFactorTicket { get; init; }

    public SessionTokenPair? Session { get; init; }

    public static AccountRegistrationResult Success(Account account, string? twoFactorTicket = null, SessionTokenPair? session = null) =>
        new()
        {
            Succeeded = true,
            Account = account,
            TwoFactorRequirement = TwoFactorPolicy.Determine(account),
            TwoFactorTicket = twoFactorTicket,
            Session = session,
        };

    public static AccountRegistrationResult Failure(AccountRegistrationFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
