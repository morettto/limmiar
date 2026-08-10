namespace Api.Accounts;

public sealed record WebAuthnRegistrationCeremony
{
    public required string ExpectedChallenge { get; init; }

    public required string ExpectedRelyingPartyId { get; init; }

    public required string ExpectedOrigin { get; init; }

    public required byte[] CredentialId { get; init; }

    public required byte[] ClientDataJson { get; init; }

    public required byte[] AttestationObject { get; init; }
}
