namespace Api.Accounts;

public enum ConfirmTotpEnrollmentFailureReason
{
    AccountNotFound,

    /// <summary>
    /// No pending enrollment to confirm -- either <see cref="AccountService.BeginTotpEnrollmentAsync"/>
    /// was never called, or the account had already confirmed one before (reconfiguring an
    /// already-enabled account is out of this ticket's scope).
    /// </summary>
    NotPending,

    InvalidCode,
}

public sealed class ConfirmTotpEnrollmentResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    /// <summary>The 10 backup codes IN CLEAR TEXT -- the only call that ever exposes them. Meaningless when <see cref="Succeeded"/> is false.</summary>
    public IReadOnlyList<string>? BackupCodes { get; init; }

    public ConfirmTotpEnrollmentFailureReason? FailureReason { get; init; }

    /// <summary>
    /// The session issued by this call (Spec S02, ticket S02-08) -- a first-time TOTP
    /// enrollment confirmation completes the professional's login (ADR-S02-03: no separate
    /// challenge is required the very first time), so this is one of the two points
    /// (alongside <see cref="AccountService.VerifyTotpChallengeAsync"/>) where a
    /// professional account actually receives a session. Never null when
    /// <see cref="Succeeded"/> is true.
    /// </summary>
    public SessionTokenPair? Session { get; init; }

    public static ConfirmTotpEnrollmentResult Success(Account account, IReadOnlyList<string> backupCodes, SessionTokenPair session) =>
        new() { Succeeded = true, Account = account, BackupCodes = backupCodes, Session = session };

    public static ConfirmTotpEnrollmentResult Failure(ConfirmTotpEnrollmentFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
