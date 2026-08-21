namespace Api.Accounts;

public enum RefreshSessionFailureReason
{
    InvalidToken,
}

public sealed class RefreshSessionResult
{
    public required bool Succeeded { get; init; }

    public SessionTokenPair? TokenPair { get; init; }

    public RefreshSessionFailureReason? FailureReason { get; init; }

    public static RefreshSessionResult Success(SessionTokenPair tokenPair) =>
        new() { Succeeded = true, TokenPair = tokenPair };

    public static RefreshSessionResult Failure() =>
        new() { Succeeded = false, FailureReason = RefreshSessionFailureReason.InvalidToken };
}
