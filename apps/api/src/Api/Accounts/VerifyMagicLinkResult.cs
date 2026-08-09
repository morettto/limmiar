namespace Api.Accounts;

/// <summary>
/// Deliberately the only member -- see <see cref="MagicLinkIssuer.ConsumeToken"/>'s doc
/// comment for why "never issued"/"expired"/"already used" collapse into one outcome instead
/// of three.
/// </summary>
public enum VerifyMagicLinkFailureReason
{
    InvalidToken,
}

/// <summary>Result of <see cref="AccountService.VerifyMagicLinkAsync"/>.</summary>
public sealed class VerifyMagicLinkResult
{
    public required bool Succeeded { get; init; }

    public VerifyMagicLinkFailureReason? FailureReason { get; init; }

    /// <summary>The opaque ticket <see cref="AccountService.CompleteMagicLinkWebAuthnAsync"/> requires. Meaningless when <see cref="Succeeded"/> is false.</summary>
    public string? MagicLinkTicket { get; init; }

    public MagicLinkCeremonyType? CeremonyType { get; init; }

    /// <summary>The fresh random challenge the caller must feed to <c>navigator.credentials.create()</c>/<c>.get()</c>.</summary>
    public byte[]? Challenge { get; init; }

    /// <summary>
    /// Set only when <see cref="CeremonyType"/> is <see cref="MagicLinkCeremonyType.Assert"/>
    /// -- the credential id the caller must put in <c>allowCredentials</c> so the browser
    /// asks the right authenticator. Deliberately the ONLY piece of stored credential material
    /// this result exposes: <see cref="Account.WebAuthnCosePublicKey"/> and
    /// <see cref="Account.WebAuthnSignCount"/> are server-side ceremony-verification secrets
    /// and must never reach an HTTP response.
    /// </summary>
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
