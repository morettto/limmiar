namespace Api.Accounts;

public enum VerifyMagicLinkFailureReason
{
    InvalidToken,
}

public sealed class VerifyMagicLinkResult
{
    public required bool Succeeded { get; init; }

    public VerifyMagicLinkFailureReason? FailureReason { get; init; }

    public string? MagicLinkTicket { get; init; }

    public MagicLinkCeremonyType? CeremonyType { get; init; }

    public byte[]? Challenge { get; init; }

    // Only stored credential material exposed here: CosePublicKey/SignCount must never reach an HTTP response.
    public byte[]? CredentialId { get; init; }

    public static VerifyMagicLinkResult Success(
        string magicLinkTicket, MagicLinkCeremonyType ceremonyType, byte[] challenge, byte[]? credentialId) =>
        new()
        {
            Succeeded = true,
            MagicLinkTicket = magicLinkTicket,
            CeremonyType = ceremonyType,
            Challenge = challenge,
            CredentialId = credentialId,
        };

    public static VerifyMagicLinkResult Failure() =>
        new() { Succeeded = false, FailureReason = VerifyMagicLinkFailureReason.InvalidToken };
}
