namespace Api.Accounts;

public enum SubmitPairingPayloadFailureReason
{
    NotFound,
    NotClaimedYet,
    AlreadySubmitted,
}

public sealed class SubmitPairingPayloadResult
{
    public required bool Succeeded { get; init; }

    public SubmitPairingPayloadFailureReason? FailureReason { get; init; }

    public static SubmitPairingPayloadResult Success() =>
        new() { Succeeded = true };

    public static SubmitPairingPayloadResult Failure(SubmitPairingPayloadFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
