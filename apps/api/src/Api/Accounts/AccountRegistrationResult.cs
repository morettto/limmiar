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

    public static AccountRegistrationResult Success(Account account) =>
        new() { Succeeded = true, Account = account };

    public static AccountRegistrationResult Failure(AccountRegistrationFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
