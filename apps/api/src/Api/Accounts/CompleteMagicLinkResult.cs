namespace Api.Accounts;

public enum CompleteMagicLinkFailureReason
{
    CeremonyFailed,
}

public sealed class CompleteMagicLinkResult
{
    public required bool Succeeded { get; init; }

    public CompleteMagicLinkFailureReason? FailureReason { get; init; }

    public Account? Account { get; init; }

    public SessionTokenPair? Session { get; init; }

    public static CompleteMagicLinkResult Success(Account account, SessionTokenPair session) =>
        new() { Succeeded = true, Account = account, Session = session };

    public static CompleteMagicLinkResult Failure() =>
        new() { Succeeded = false, FailureReason = CompleteMagicLinkFailureReason.CeremonyFailed };
}
