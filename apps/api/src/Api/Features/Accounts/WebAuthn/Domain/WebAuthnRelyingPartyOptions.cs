namespace Api.Accounts;

public sealed record WebAuthnRelyingPartyOptions(string RelyingPartyId, string ExpectedOrigin);
