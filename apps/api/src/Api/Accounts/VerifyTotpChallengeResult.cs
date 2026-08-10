namespace Api.Accounts;

public enum VerifyTotpChallengeFailureReason
{
    AccountNotFound,
    NotEnabled,
    InvalidCode,
}

public sealed class VerifyTotpChallengeResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public VerifyTotpChallengeFailureReason? FailureReason { get; init; }

    public SessionTokenPair? Session { get; init; }

    public static VerifyTotpChallengeResult Success(Account account, SessionTokenPair session) =>
        new() { Succeeded = true, Account = account, Session = session };

    public static VerifyTotpChallengeResult Failure(VerifyTotpChallengeFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
