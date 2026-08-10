namespace Api.Accounts;

// Server-side diagnostic only: never echo a specific value back to the browser.
public enum WebAuthnCeremonyFailureReason
{
    MalformedResponse,
    CeremonyTypeMismatch,
    ChallengeMismatch,
    OriginMismatch,
    RelyingPartyMismatch,
    UserNotPresent,
    UserNotVerified,
    UnsupportedAlgorithm,
    InvalidSignature,
    SignCountNotAdvanced,
}
