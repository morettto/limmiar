namespace Api.Accounts;

/// <summary>
/// Why a WebAuthn ceremony was rejected. Shared by <see cref="WebAuthnRegistrationResult"/>
/// and <see cref="WebAuthnAssertionResult"/> because both ceremonies fail for almost exactly
/// the same reasons (WebAuthn L3 sections 7.1 and 7.2 are near-mirror checklists).
///
/// This is a SERVER-SIDE diagnostic, not something to echo back to the browser: telling a
/// caller which specific check failed hands an attacker a free oracle for probing the RP id /
/// origin / challenge binding. Endpoints built on top of this must collapse every value here
/// into one opaque problem code.
/// </summary>
public enum WebAuthnCeremonyFailureReason
{
    /// <summary>
    /// The bytes are not a well-formed ceremony response at all -- unparseable CBOR
    /// attestation object, unparseable clientDataJSON, authenticator data shorter than the
    /// 37-byte minimum, or missing attested credential data on a registration.
    /// </summary>
    MalformedResponse,

    /// <summary>clientDataJSON's <c>type</c> was not the one this ceremony expects (<c>webauthn.create</c> / <c>webauthn.get</c>).</summary>
    CeremonyTypeMismatch,

    /// <summary>clientDataJSON's <c>challenge</c> did not match the challenge the server issued -- the replay barrier.</summary>
    ChallengeMismatch,

    /// <summary>clientDataJSON's <c>origin</c> did not match the expected origin -- the phishing barrier.</summary>
    OriginMismatch,

    /// <summary>Authenticator data's RP ID hash was not SHA-256 of the expected relying party id.</summary>
    RelyingPartyMismatch,

    /// <summary>The User Present (UP) flag was clear: nobody physically interacted with the authenticator.</summary>
    UserNotPresent,

    /// <summary>The User Verified (UV) flag was clear: the authenticator did not perform a biometric/PIN gesture. See <see cref="WebAuthnCeremonyVerifier"/> for why S02-05 requires this.</summary>
    UserNotVerified,

    /// <summary>The credential's COSE algorithm is not ES256 (alg -7). See <see cref="WebAuthnCeremonyVerifier"/> for why nothing else is accepted.</summary>
    UnsupportedAlgorithm,

    /// <summary>The assertion signature did not verify against the stored public key.</summary>
    InvalidSignature,

    /// <summary>
    /// The authenticator's signature counter did not strictly advance -- the WebAuthn L3
    /// section 6.1.1 cloned-authenticator signal. See
    /// <see cref="WebAuthnCeremonyVerifier.HasAdvanced"/> for the exact rule and its one
    /// legitimate exception.
    /// </summary>
    SignCountNotAdvanced,
}
