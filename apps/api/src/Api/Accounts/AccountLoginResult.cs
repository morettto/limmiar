namespace Api.Accounts;

/// <summary>
/// Deliberately the only member. A second value such as "EmailNotFound" would let
/// <c>Api.Endpoints.AuthEndpoints</c> map unknown-email and wrong-password to different
/// responses -- exactly the account-enumeration side channel
/// <see cref="AccountService.LoginAsync"/> exists to close. If a future failure reason is
/// ever needed here, confirm it can't reveal whether an e-mail is registered before
/// adding it.
/// </summary>
public enum AccountLoginFailureReason
{
    InvalidCredentials,
}

public sealed class AccountLoginResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public AccountLoginFailureReason? FailureReason { get; init; }

    public static AccountLoginResult Success(Account account) =>
        new() { Succeeded = true, Account = account };

    public static AccountLoginResult Failure(AccountLoginFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
