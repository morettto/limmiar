namespace Api.Accounts;

/// <summary>
/// Verifies the two WebAuthn ceremonies S02-05 needs from a platform authenticator (Face ID /
/// Touch ID / Windows Hello): registration (<c>navigator.credentials.create()</c>) and
/// assertion (<c>navigator.credentials.get()</c>).
///
/// Scope is deliberately narrow: this is the crypto/ceremony layer only. It issues no
/// challenges, holds no state between the two calls, knows nothing about magic links or
/// accounts, and never persists anything -- the caller owns challenge issuance/expiry and
/// owns storing <see cref="WebAuthnCredentialRegistration"/> plus the counter returned by
/// <see cref="WebAuthnAssertionResult.NewSignCount"/>.
/// </summary>
public interface IWebAuthnCeremonyVerifier
{
    /// <summary>
    /// Verifies a registration ceremony and, on success, returns the credential material to
    /// persist. Attestation statements are parsed but their signatures are NOT verified: the
    /// ticket's acceptance criteria never ask "which authenticator model is this?", and
    /// verifying attestation would drag in an authenticator metadata service for no gain.
    /// </summary>
    Task<WebAuthnRegistrationResult> VerifyRegistrationAsync(
        WebAuthnRegistrationCeremony ceremony,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Verifies an assertion ceremony against a previously registered credential. Returns the
    /// authenticator's new signature counter, which the caller MUST persist -- see
    /// <see cref="WebAuthnAssertionResult.NewSignCount"/>.
    /// </summary>
    Task<WebAuthnAssertionResult> VerifyAssertionAsync(
        WebAuthnAssertionCeremony ceremony,
        CancellationToken cancellationToken = default);
}
