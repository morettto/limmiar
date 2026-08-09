namespace Api.Accounts;

/// <summary>
/// Everything needed to verify one <c>navigator.credentials.create()</c> result: the three
/// values the server itself chose and must hold the browser to (<see cref="ExpectedChallenge"/>,
/// <see cref="ExpectedRelyingPartyId"/>, <see cref="ExpectedOrigin"/>) plus the raw
/// <c>PublicKeyCredential</c> the browser handed back.
///
/// Deliberately carries no account/session identity: binding the resulting credential to an
/// account is the caller's job (<see cref="AccountService"/>), which keeps this verifier a
/// pure function of "these bytes against these expectations".
/// </summary>
public sealed record WebAuthnRegistrationCeremony
{
    /// <summary>
    /// The base64url challenge the server issued, compared verbatim against clientDataJSON's
    /// <c>challenge</c> member. Base64url (not raw bytes) because that is the exact form the
    /// browser writes into clientDataJSON, so the comparison needs no re-encoding step that
    /// could itself disagree about padding.
    /// </summary>
    public required string ExpectedChallenge { get; init; }

    /// <summary>The RP ID (a registrable domain, e.g. <c>limmiar.app</c> -- no scheme, no port).</summary>
    public required string ExpectedRelyingPartyId { get; init; }

    /// <summary>The full origin the ceremony must have come from, e.g. <c>https://limmiar.app</c>.</summary>
    public required string ExpectedOrigin { get; init; }

    /// <summary><c>PublicKeyCredential.rawId</c>.</summary>
    public required byte[] CredentialId { get; init; }

    /// <summary><c>response.clientDataJSON</c>, still as raw UTF-8 bytes -- it is hashed as-is into the signed payload, so it must never be round-tripped through a string.</summary>
    public required byte[] ClientDataJson { get; init; }

    /// <summary><c>response.attestationObject</c>: the CBOR map carrying <c>fmt</c>, <c>attStmt</c> and the authenticator data with the attested credential inside.</summary>
    public required byte[] AttestationObject { get; init; }
}
