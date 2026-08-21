namespace Api.Accounts;

public enum PairingClaimStatusFailureReason
{
    NotFound,
}

public sealed class PairingClaimStatusResult
{
    public required bool Succeeded { get; init; }

    public bool Claimed { get; init; }

    public byte[]? NewDevicePublicKey { get; init; }

    public PairingClaimStatusFailureReason? FailureReason { get; init; }

    public static PairingClaimStatusResult Pending() =>
        new() { Succeeded = true, Claimed = false };

    public static PairingClaimStatusResult ClaimedBy(byte[] newDevicePublicKey) =>
        new() { Succeeded = true, Claimed = true, NewDevicePublicKey = newDevicePublicKey };

    public static PairingClaimStatusResult Failure() =>
        new() { Succeeded = false, FailureReason = PairingClaimStatusFailureReason.NotFound };
}
