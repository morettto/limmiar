namespace Api.Accounts;

/// <summary>
/// Deliberately the only member. <see cref="IDevicePairingIssuer.FetchPayload"/> can come up
/// empty because the session id was never issued, has expired, has no payload submitted yet,
/// or already handed its payload over once -- and no legitimate caller needs to tell those
/// apart: the claiming device simply keeps polling until it gets the ciphertext, then stops.
/// Distinguishing them would tell someone replaying a session id whether it was ever real
/// and whether they arrived too late, which is exactly the signal a stolen-QR attack wants.
/// Same one-code-for-all-reasons discipline as
/// <see cref="Api.Problems.ProblemCodes.AuthRefreshTokenInvalid"/>.
/// </summary>
public enum FetchPairingPayloadFailureReason
{
    NotFound,
}

public sealed class FetchPairingPayloadResult
{
    public required bool Succeeded { get; init; }

    /// <summary>
    /// The primary device's KEK, encrypted to the claiming device -- relayed verbatim, never
    /// interpreted by this backend. Meaningless when <see cref="Succeeded"/> is false.
    /// </summary>
    public byte[]? EncryptedKek { get; init; }

    public FetchPairingPayloadFailureReason? FailureReason { get; init; }

    public static FetchPairingPayloadResult Success(byte[] encryptedKek) =>
        new() { Succeeded = true, EncryptedKek = encryptedKek };

    public static FetchPairingPayloadResult Failure() =>
        new() { Succeeded = false, FailureReason = FetchPairingPayloadFailureReason.NotFound };
}
