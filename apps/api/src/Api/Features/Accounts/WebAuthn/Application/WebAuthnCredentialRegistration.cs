namespace Api.Accounts;

public sealed record WebAuthnCredentialRegistration(
    byte[] CredentialId,
    byte[] CosePublicKey,
    uint SignCount,
    Guid AaGuid);
