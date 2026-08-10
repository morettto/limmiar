namespace Api.Accounts;

public interface IWebAuthnCeremonyVerifier
{
    // Attestation statement signatures are parsed but not cryptographically verified (out of scope).
    Task<WebAuthnRegistrationResult> VerifyRegistrationAsync(
        WebAuthnRegistrationCeremony ceremony,
        CancellationToken cancellationToken = default);

    Task<WebAuthnAssertionResult> VerifyAssertionAsync(
        WebAuthnAssertionCeremony ceremony,
        CancellationToken cancellationToken = default);
}
