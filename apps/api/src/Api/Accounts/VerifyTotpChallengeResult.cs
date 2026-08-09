namespace Api.Accounts;

public enum VerifyTotpChallengeFailureReason
{
    AccountNotFound,

    /// <summary>2FA was never confirmed for this account (<see cref="Account.TotpEnabledAt"/> is null) -- there's nothing to challenge.</summary>
    NotEnabled,

    InvalidCode,
}

public sealed class VerifyTotpChallengeResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public VerifyTotpChallengeFailureReason? FailureReason { get; init; }

    /// <summary>
    /// The session issued by this call (Spec S02, ticket S02-08) -- a successful TOTP (or
    /// backup code) challenge completes a professional's login. Never null when
    /// <see cref="Succeeded"/> is true.
    /// </summary>
    public SessionTokenPair? Session { get; init; }

    public static VerifyTotpChallengeResult Success(Account account, SessionTokenPair session) =>
        new() { Succeeded = true, Account = account, Session = session };

    public static VerifyTotpChallengeResult Failure(VerifyTotpChallengeFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
