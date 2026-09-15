namespace Api.Tests.Infrastructure;

/// <summary>
/// A fixed, valid 32-byte AES-256-GCM key for <c>Totp:EncryptionKey</c> (see
/// <see cref="Api.Accounts.TwoFactorComposition.AddTwoFactor"/>), shared by every test that
/// boots the real app via <c>WebApplicationFactory&lt;Program&gt;</c>. Startup fails closed
/// without it -- same discipline as every other required secret
/// (<c>StaffAccess:ApiKey</c>, <c>WebAuthn:RelyingPartyId</c>/<c>ExpectedOrigin</c>,
/// <c>AbacatePay:WebhookSecret</c>) -- so tests supply a fixed test value rather than the
/// production secret ever appearing here.
/// </summary>
public static class TotpTestEncryptionKey
{
    public const string Base64 = "VFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFQ=";
}
