namespace Api.Accounts;

/// <summary>
/// Unlike <see cref="ClaimPairingSessionFailureReason"/> and
/// <see cref="FetchPairingPayloadFailureReason"/>, these reasons are safe to distinguish:
/// every one of them is only ever reported to the primary device, which already proved it
/// owns the session (<see cref="NotFound"/> is what a caller gets for any session it does
/// NOT own, so nothing here tells a stranger anything). Telling the primary "nobody has
/// scanned yet" apart from "you already sent this" is exactly what it needs to drive its
/// own UI.
/// </summary>
public enum SubmitPairingPayloadFailureReason
{
    /// <summary>Unknown session id, expired session, or one belonging to another account -- deliberately one code for all three.</summary>
    NotFound,

    /// <summary>No device has scanned the QR code yet, so there is no public key to have encrypted for.</summary>
    NotClaimedYet,

    /// <summary>A payload was already submitted for this session. One handshake, one ciphertext.</summary>
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
