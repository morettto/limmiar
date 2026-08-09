namespace Api.Accounts;

public sealed class WebAuthnRegistrationResult
{
    public required bool Succeeded { get; init; }

    /// <summary>The credential material to persist. Meaningless when <see cref="Succeeded"/> is false.</summary>
    public WebAuthnCredentialRegistration? Credential { get; init; }

    public WebAuthnCeremonyFailureReason? FailureReason { get; init; }

    public static WebAuthnRegistrationResult Success(WebAuthnCredentialRegistration credential) =>
        new() { Succeeded = true, Credential = credential };

    public static WebAuthnRegistrationResult Failure(WebAuthnCeremonyFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
