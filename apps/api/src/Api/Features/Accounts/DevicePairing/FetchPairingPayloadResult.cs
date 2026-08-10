namespace Api.Accounts;

public enum FetchPairingPayloadFailureReason
{
    NotFound,
}

public sealed class FetchPairingPayloadResult
{
    public required bool Succeeded { get; init; }

    public byte[]? EncryptedKek { get; init; }

    public FetchPairingPayloadFailureReason? FailureReason { get; init; }

    public static FetchPairingPayloadResult Success(byte[] encryptedKek) =>
        new() { Succeeded = true, EncryptedKek = encryptedKek };

    public static FetchPairingPayloadResult Failure() =>
        new() { Succeeded = false, FailureReason = FetchPairingPayloadFailureReason.NotFound };
}
