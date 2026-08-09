namespace Api.Accounts;

/// <summary>
/// Everything needed to verify one <c>navigator.credentials.get()</c> result: the server's
/// expectations, the credential material persisted by a prior
/// <see cref="IWebAuthnCeremonyVerifier.VerifyRegistrationAsync"/>, and the raw
/// <c>PublicKeyCredential</c> the browser handed back.
/// </summary>
public sealed record WebAuthnAssertionCeremony
{
    /// <summary>The base64url challenge the server issued. See <see cref="WebAuthnRegistrationCeremony.ExpectedChallenge"/>.</summary>
    public required string ExpectedChallenge { get; init; }

    /// <summary>The RP ID (a registrable domain, e.g. <c>limmiar.app</c> -- no scheme, no port).</summary>
    public required string ExpectedRelyingPartyId { get; init; }

    /// <summary>The full origin the ceremony must have come from, e.g. <c>https://limmiar.app</c>.</summary>
    public required string ExpectedOrigin { get; init; }

    /// <summary><c>PublicKeyCredential.rawId</c>. The caller has already used it to look up the stored credential below; it is repeated here so the verifier can hold the response to the credential the server actually allow-listed.</summary>
    public required byte[] CredentialId { get; init; }

    /// <summary><see cref="WebAuthnCredentialRegistration.CosePublicKey"/> exactly as it was stored at registration time.</summary>
    public required byte[] StoredCosePublicKey { get; init; }

    /// <summary><see cref="WebAuthnCredentialRegistration.SignCount"/> from the last successful ceremony for this credential -- the clone-detection baseline.</summary>
    public required uint StoredSignCount { get; init; }

    /// <summary><c>response.clientDataJSON</c>, still as raw UTF-8 bytes.</summary>
    public required byte[] ClientDataJson { get; init; }

    /// <summary><c>response.authenticatorData</c> (no attested credential data on an assertion).</summary>
    public required byte[] AuthenticatorData { get; init; }

    /// <summary><c>response.signature</c>: ASN.1 DER ECDSA signature over <c>authenticatorData || SHA-256(clientDataJSON)</c>.</summary>
    public required byte[] Signature { get; init; }

    /// <summary>
    /// <c>response.userHandle</c>, which authenticators send for discoverable credentials and
    /// omit (null) otherwise -- both are legal, so this is optional.
    ///
    /// The verifier carries it but does NOT bind it to an account: S02-05 arrives at the
    /// assertion already knowing which account it is confirming (the magic link said so) and
    /// looks the stored credential up by <see cref="CredentialId"/>, so the credential-to-account
    /// binding is established before this ceremony starts and re-deriving it from a
    /// client-supplied handle would only add a second, weaker path to the same conclusion.
    /// It is modelled here rather than dropped because the underlying library dereferences a
    /// user-handle callback whenever the field is populated -- silently discarding it would
    /// leave that path untested and reachable from the browser.
    /// </summary>
    public byte[]? UserHandle { get; init; }
}
