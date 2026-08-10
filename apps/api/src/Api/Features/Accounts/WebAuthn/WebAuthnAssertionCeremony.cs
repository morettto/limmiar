namespace Api.Accounts;

public sealed record WebAuthnAssertionCeremony
{
    public required string ExpectedChallenge { get; init; }

    public required string ExpectedRelyingPartyId { get; init; }

    public required string ExpectedOrigin { get; init; }

    public required byte[] CredentialId { get; init; }

    public required byte[] StoredCosePublicKey { get; init; }

    public required uint StoredSignCount { get; init; }

    public required byte[] ClientDataJson { get; init; }

    public required byte[] AuthenticatorData { get; init; }

    public required byte[] Signature { get; init; }

    // Carried but not bound to an account: the caller already knows the account from the
    // magic link, and the library dereferences this field's callback whenever it is populated.
    public byte[]? UserHandle { get; init; }
}
