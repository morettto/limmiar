namespace Api.Accounts;

public enum ConfirmTotpEnrollmentFailureReason
{
    AccountNotFound,
    NotPending,
    InvalidCode,
}

public sealed class ConfirmTotpEnrollmentResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public IReadOnlyList<string>? BackupCodes { get; init; }

    public ConfirmTotpEnrollmentFailureReason? FailureReason { get; init; }

    public SessionTokenPair? Session { get; init; }

    public static ConfirmTotpEnrollmentResult Success(Account account, IReadOnlyList<string> backupCodes, SessionTokenPair session) =>
        new() { Succeeded = true, Account = account, BackupCodes = backupCodes, Session = session };

    public static ConfirmTotpEnrollmentResult Failure(ConfirmTotpEnrollmentFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
