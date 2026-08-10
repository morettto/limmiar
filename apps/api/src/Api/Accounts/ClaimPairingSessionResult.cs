namespace Api.Accounts;

public enum ClaimPairingSessionFailureReason
{
    NotFound,
}

public sealed class ClaimPairingSessionResult
{
    public required bool Succeeded { get; init; }

    public byte[]? PrimaryPublicKey { get; init; }

    public ClaimPairingSessionFailureReason? FailureReason { get; init; }

    public static ClaimPairingSessionResult Success(byte[] primaryPublicKey) =>
        new() { Succeeded = true, PrimaryPublicKey = primaryPublicKey };

    public static ClaimPairingSessionResult Failure() =>
        new() { Succeeded = false, FailureReason = ClaimPairingSessionFailureReason.NotFound };
}
