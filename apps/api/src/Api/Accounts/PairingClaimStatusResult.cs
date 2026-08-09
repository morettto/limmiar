namespace Api.Accounts;

/// <summary>
/// Deliberately the only member. <see cref="IDevicePairingIssuer.GetClaimStatus"/> fails
/// when the session id was never issued, has expired, or belongs to a DIFFERENT account
/// than the caller -- and the caller must not be able to tell those apart, or polling with
/// guessed ids becomes a probe for which pairing sessions other accounts currently have
/// open. Same one-code-for-all-reasons discipline as
/// <see cref="ClaimPairingSessionFailureReason"/>.
/// </summary>
public enum PairingClaimStatusFailureReason
{
    NotFound,
}

public sealed class PairingClaimStatusResult
{
    public required bool Succeeded { get; init; }

    /// <summary>
    /// False while the session is still waiting for a device to scan the QR code; true once
    /// one has. Meaningless when <see cref="Succeeded"/> is false.
    /// </summary>
    public bool Claimed { get; init; }

    /// <summary>
    /// The claiming device's raw X25519 public key -- what the primary needs to encrypt its
    /// KEK for. Null until <see cref="Claimed"/> is true.
    /// </summary>
    public byte[]? NewDevicePublicKey { get; init; }

    public PairingClaimStatusFailureReason? FailureReason { get; init; }

    /// <summary>The session exists and belongs to the caller, but nobody has scanned it yet.</summary>
    public static PairingClaimStatusResult Pending() =>
        new() { Succeeded = true, Claimed = false };

    public static PairingClaimStatusResult ClaimedBy(byte[] newDevicePublicKey) =>
        new() { Succeeded = true, Claimed = true, NewDevicePublicKey = newDevicePublicKey };

    public static PairingClaimStatusResult Failure() =>
        new() { Succeeded = false, FailureReason = PairingClaimStatusFailureReason.NotFound };
}
