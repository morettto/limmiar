namespace Api.Accounts;

public enum AccountGoogleAuthFailureReason
{
    InvalidGoogleToken,
}

public sealed class AccountGoogleAuthResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    /// <summary>
    /// True when this call created a brand-new account; false when it resolved to an
    /// account that already existed for this Google identity's e-mail (ADR-S02-01: role
    /// resolved automatically, no re-prompt). Meaningless when <see cref="Succeeded"/> is
    /// false.
    /// </summary>
    public bool IsNewAccount { get; init; }

    public AccountGoogleAuthFailureReason? FailureReason { get; init; }

    public static AccountGoogleAuthResult Success(Account account, bool isNewAccount) =>
        new() { Succeeded = true, Account = account, IsNewAccount = isNewAccount };

    public static AccountGoogleAuthResult Failure(AccountGoogleAuthFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
