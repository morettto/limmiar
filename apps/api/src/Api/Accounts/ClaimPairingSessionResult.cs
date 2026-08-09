namespace Api.Accounts;

/// <summary>
/// Deliberately the only member. <see cref="IDevicePairingIssuer.Claim"/> can fail because
/// the session id was never issued, has expired, or was already claimed by another device --
/// but a caller must never learn which: telling someone scanning guessed/photographed QR
/// payloads apart ("wrong id" vs. "real id, someone beat you to it") hands them a live
/// oracle over which pairing sessions exist. Same one-code-for-all-reasons discipline as
/// <see cref="RefreshSessionFailureReason"/> and
/// <see cref="Api.Problems.ProblemCodes.AuthRefreshTokenInvalid"/>. If a second value is
/// ever needed here, confirm it can't leak that distinction before adding it.
/// </summary>
public enum ClaimPairingSessionFailureReason
{
    NotFound,
}

public sealed class ClaimPairingSessionResult
{
    public required bool Succeeded { get; init; }

    /// <summary>
    /// The primary device's raw X25519 public key, so the claiming device can derive the
    /// shared secret for this pairing. Opaque to the server. Meaningless when
    /// <see cref="Succeeded"/> is false.
    /// </summary>
    public byte[]? PrimaryPublicKey { get; init; }

    public ClaimPairingSessionFailureReason? FailureReason { get; init; }

    public static ClaimPairingSessionResult Success(byte[] primaryPublicKey) =>
        new() { Succeeded = true, PrimaryPublicKey = primaryPublicKey };

    public static ClaimPairingSessionResult Failure() =>
        new() { Succeeded = false, FailureReason = ClaimPairingSessionFailureReason.NotFound };
}
