using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Covers <see cref="DevicePairingIssuer"/> directly -- session creation, the two
/// independent single-use surfaces (claiming the QR session and fetching the payload), and
/// expiry (driven by an injected fake clock, same discipline as
/// <see cref="TwoFactorTicketIssuerTests"/>/<see cref="SessionTokenIssuerTests"/>, never a
/// real <c>Thread.Sleep</c>).
/// </summary>
public sealed class DevicePairingIssuerTests
{
    private static readonly byte[] PrimaryPublicKey = [1, 2, 3, 4];
    private static readonly byte[] NewDevicePublicKey = [9, 8, 7, 6];
    private static readonly byte[] EncryptedKek = [0xDE, 0xAD, 0xBE, 0xEF];

    [Fact]
    public void Create_ReturnsSessionIdExpiringOnePairingLifetimeFromNow()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new DevicePairingIssuer(clock: () => now);

        var session = issuer.Create(Guid.NewGuid(), PrimaryPublicKey);

        Assert.NotEmpty(session.SessionId);
        Assert.Equal(now + DevicePairingIssuer.PairingSessionLifetime, session.ExpiresAt);
    }

    [Fact]
    public void Create_ReturnsDifferentSessionIdsForDifferentCalls()
    {
        var issuer = new DevicePairingIssuer();

        var first = issuer.Create(Guid.NewGuid(), PrimaryPublicKey);
        var second = issuer.Create(Guid.NewGuid(), PrimaryPublicKey);

        Assert.NotEqual(first.SessionId, second.SessionId);
    }

    [Fact]
    public void Claim_WithUnknownSessionId_ReturnsNotFound()
    {
        var issuer = new DevicePairingIssuer();

        var result = issuer.Claim("never-created", NewDevicePublicKey);

        Assert.False(result.Succeeded);
        Assert.Equal(ClaimPairingSessionFailureReason.NotFound, result.FailureReason);
    }

    [Fact]
    public void Claim_OnUnclaimedSession_ReturnsThePrimaryDevicesPublicKey()
    {
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(Guid.NewGuid(), PrimaryPublicKey);

        var result = issuer.Claim(session.SessionId, NewDevicePublicKey);

        Assert.True(result.Succeeded);
        Assert.Equal(PrimaryPublicKey, result.PrimaryPublicKey);
    }

    /// <summary>
    /// Core QR-replay rule: a pairing QR code is worth exactly one claim. Anyone who
    /// photographs, screenshots, or shoulder-surfs the code and scans it after the
    /// legitimate device already did must be indistinguishable from someone who made the
    /// session id up -- hence <see cref="ClaimPairingSessionFailureReason.NotFound"/>, not
    /// an "already claimed" tell.
    /// </summary>
    [Fact]
    public void Claim_CalledTwice_SecondCallReturnsNotFound()
    {
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(Guid.NewGuid(), PrimaryPublicKey);

        issuer.Claim(session.SessionId, NewDevicePublicKey);
        var second = issuer.Claim(session.SessionId, [5, 5, 5, 5]);

        Assert.False(second.Succeeded);
        Assert.Equal(ClaimPairingSessionFailureReason.NotFound, second.FailureReason);
    }

    [Fact]
    public void Claim_AfterPairingSessionLifetimeElapses_ReturnsNotFound()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new DevicePairingIssuer(clock: () => now);
        var session = issuer.Create(Guid.NewGuid(), PrimaryPublicKey);

        now += DevicePairingIssuer.PairingSessionLifetime + TimeSpan.FromSeconds(1);

        var result = issuer.Claim(session.SessionId, NewDevicePublicKey);

        Assert.False(result.Succeeded);
        Assert.Equal(ClaimPairingSessionFailureReason.NotFound, result.FailureReason);
    }

    [Fact]
    public void Claim_JustBeforePairingSessionLifetimeElapses_Succeeds()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new DevicePairingIssuer(clock: () => now);
        var session = issuer.Create(Guid.NewGuid(), PrimaryPublicKey);

        now += DevicePairingIssuer.PairingSessionLifetime - TimeSpan.FromSeconds(1);

        Assert.True(issuer.Claim(session.SessionId, NewDevicePublicKey).Succeeded);
    }

    [Fact]
    public void GetClaimStatus_BeforeAnyClaim_ReturnsPending()
    {
        var accountId = Guid.NewGuid();
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(accountId, PrimaryPublicKey);

        var status = issuer.GetClaimStatus(session.SessionId, accountId);

        Assert.True(status.Succeeded);
        Assert.False(status.Claimed);
        Assert.Null(status.NewDevicePublicKey);
    }

    [Fact]
    public void GetClaimStatus_AfterClaim_ReturnsTheNewDevicesPublicKey()
    {
        var accountId = Guid.NewGuid();
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(accountId, PrimaryPublicKey);
        issuer.Claim(session.SessionId, NewDevicePublicKey);

        var status = issuer.GetClaimStatus(session.SessionId, accountId);

        Assert.True(status.Succeeded);
        Assert.True(status.Claimed);
        Assert.Equal(NewDevicePublicKey, status.NewDevicePublicKey);
    }

    /// <summary>
    /// The primary device polls this in a loop while the QR is on screen, so unlike
    /// <see cref="IDevicePairingIssuer.Claim"/> and
    /// <see cref="IDevicePairingIssuer.FetchPayload"/> it must NOT consume anything --
    /// polling twice has to keep answering the same thing.
    /// </summary>
    [Fact]
    public void GetClaimStatus_PolledRepeatedlyAfterClaim_KeepsReturningClaimed()
    {
        var accountId = Guid.NewGuid();
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(accountId, PrimaryPublicKey);
        issuer.Claim(session.SessionId, NewDevicePublicKey);

        var first = issuer.GetClaimStatus(session.SessionId, accountId);
        var second = issuer.GetClaimStatus(session.SessionId, accountId);

        Assert.True(first.Claimed);
        Assert.True(second.Claimed);
        Assert.Equal(NewDevicePublicKey, second.NewDevicePublicKey);
    }

    [Fact]
    public void GetClaimStatus_WithUnknownSessionId_ReturnsNotFound()
    {
        var issuer = new DevicePairingIssuer();

        var status = issuer.GetClaimStatus("never-created", Guid.NewGuid());

        Assert.False(status.Succeeded);
        Assert.Equal(PairingClaimStatusFailureReason.NotFound, status.FailureReason);
    }

    /// <summary>
    /// Account-scoping/anti-leak: a session id polled by an account that does not own it
    /// must be indistinguishable from one that was never issued -- otherwise polling is a
    /// free oracle for "does this pairing session exist," and worse, hands a stranger the
    /// claiming device's public key.
    /// </summary>
    [Fact]
    public void GetClaimStatus_WithAnotherAccountsId_ReturnsNotFound()
    {
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(Guid.NewGuid(), PrimaryPublicKey);
        issuer.Claim(session.SessionId, NewDevicePublicKey);

        var status = issuer.GetClaimStatus(session.SessionId, Guid.NewGuid());

        Assert.False(status.Succeeded);
        Assert.Equal(PairingClaimStatusFailureReason.NotFound, status.FailureReason);
        Assert.Null(status.NewDevicePublicKey);
    }

    [Fact]
    public void SubmitPayload_BeforeAnyClaim_ReturnsNotClaimedYet()
    {
        var accountId = Guid.NewGuid();
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(accountId, PrimaryPublicKey);

        var result = issuer.SubmitPayload(session.SessionId, accountId, EncryptedKek);

        Assert.False(result.Succeeded);
        Assert.Equal(SubmitPairingPayloadFailureReason.NotClaimedYet, result.FailureReason);
    }

    [Fact]
    public void SubmitPayload_WithUnknownSessionId_ReturnsNotFound()
    {
        var issuer = new DevicePairingIssuer();

        var result = issuer.SubmitPayload("never-created", Guid.NewGuid(), EncryptedKek);

        Assert.False(result.Succeeded);
        Assert.Equal(SubmitPairingPayloadFailureReason.NotFound, result.FailureReason);
    }

    [Fact]
    public void SubmitPayload_AfterClaim_Succeeds()
    {
        var accountId = Guid.NewGuid();
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(accountId, PrimaryPublicKey);
        issuer.Claim(session.SessionId, NewDevicePublicKey);

        var result = issuer.SubmitPayload(session.SessionId, accountId, EncryptedKek);

        Assert.True(result.Succeeded);
        Assert.Null(result.FailureReason);
    }

    [Fact]
    public void SubmitPayload_CalledTwice_SecondCallReturnsAlreadySubmitted()
    {
        var accountId = Guid.NewGuid();
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(accountId, PrimaryPublicKey);
        issuer.Claim(session.SessionId, NewDevicePublicKey);

        issuer.SubmitPayload(session.SessionId, accountId, EncryptedKek);
        var second = issuer.SubmitPayload(session.SessionId, accountId, [1, 1, 1, 1]);

        Assert.False(second.Succeeded);
        Assert.Equal(SubmitPairingPayloadFailureReason.AlreadySubmitted, second.FailureReason);
    }

    /// <summary>
    /// Account-scoping: only the account that opened the session may hand over the KEK
    /// ciphertext for it. Reported as <see cref="SubmitPairingPayloadFailureReason.NotFound"/>,
    /// not a distinct "not yours" -- same anti-enumeration discipline as
    /// <see cref="GetClaimStatus_WithAnotherAccountsId_ReturnsNotFound"/>.
    /// </summary>
    [Fact]
    public void SubmitPayload_WithAnotherAccountsId_ReturnsNotFound()
    {
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(Guid.NewGuid(), PrimaryPublicKey);
        issuer.Claim(session.SessionId, NewDevicePublicKey);

        var result = issuer.SubmitPayload(session.SessionId, Guid.NewGuid(), EncryptedKek);

        Assert.False(result.Succeeded);
        Assert.Equal(SubmitPairingPayloadFailureReason.NotFound, result.FailureReason);
    }

    [Fact]
    public void SubmitPayload_AfterPairingSessionLifetimeElapses_ReturnsNotFound()
    {
        var accountId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        var issuer = new DevicePairingIssuer(clock: () => now);
        var session = issuer.Create(accountId, PrimaryPublicKey);
        issuer.Claim(session.SessionId, NewDevicePublicKey);

        now += DevicePairingIssuer.PairingSessionLifetime + TimeSpan.FromSeconds(1);

        var result = issuer.SubmitPayload(session.SessionId, accountId, EncryptedKek);

        Assert.False(result.Succeeded);
        Assert.Equal(SubmitPairingPayloadFailureReason.NotFound, result.FailureReason);
    }

    [Fact]
    public void FetchPayload_WithUnknownSessionId_ReturnsNotFound()
    {
        var issuer = new DevicePairingIssuer();

        var result = issuer.FetchPayload("never-created");

        Assert.False(result.Succeeded);
        Assert.Equal(FetchPairingPayloadFailureReason.NotFound, result.FailureReason);
    }

    /// <summary>
    /// The claiming device polls this while the primary is still encrypting, so "nothing
    /// submitted yet" is an ordinary, expected answer -- and it is reported with the same
    /// code as a made-up session id, so polling can never confirm that a session exists.
    /// </summary>
    [Fact]
    public void FetchPayload_BeforeThePayloadIsSubmitted_ReturnsNotFound()
    {
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(Guid.NewGuid(), PrimaryPublicKey);
        issuer.Claim(session.SessionId, NewDevicePublicKey);

        var result = issuer.FetchPayload(session.SessionId);

        Assert.False(result.Succeeded);
        Assert.Equal(FetchPairingPayloadFailureReason.NotFound, result.FailureReason);
        Assert.Null(result.EncryptedKek);
    }

    [Fact]
    public void FetchPayload_AfterSubmit_ReturnsExactlyTheSubmittedCiphertext()
    {
        var accountId = Guid.NewGuid();
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(accountId, PrimaryPublicKey);
        issuer.Claim(session.SessionId, NewDevicePublicKey);
        issuer.SubmitPayload(session.SessionId, accountId, EncryptedKek);

        var result = issuer.FetchPayload(session.SessionId);

        Assert.True(result.Succeeded);
        Assert.Equal(EncryptedKek, result.EncryptedKek);
    }

    /// <summary>
    /// Core payload-replay rule, and the second of the two INDEPENDENT single-use surfaces
    /// this issuer protects (the first being <see cref="Claim_CalledTwice_SecondCallReturnsNotFound"/>):
    /// the wrapped KEK is handed over exactly once. Anyone who later replays the session id
    /// -- including the legitimate device retrying after it already got the bytes -- gets
    /// nothing, so a captured session id can never be redeemed for key material twice.
    /// </summary>
    [Fact]
    public void FetchPayload_CalledTwice_SecondCallReturnsNotFound()
    {
        var accountId = Guid.NewGuid();
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(accountId, PrimaryPublicKey);
        issuer.Claim(session.SessionId, NewDevicePublicKey);
        issuer.SubmitPayload(session.SessionId, accountId, EncryptedKek);

        issuer.FetchPayload(session.SessionId);
        var second = issuer.FetchPayload(session.SessionId);

        Assert.False(second.Succeeded);
        Assert.Equal(FetchPairingPayloadFailureReason.NotFound, second.FailureReason);
        Assert.Null(second.EncryptedKek);
    }

    /// <summary>
    /// The consumed session is gone for every surface, not just <c>FetchPayload</c> -- the
    /// primary's poll must stop resolving it too, rather than leaving a spent session id
    /// answering questions about an account.
    /// </summary>
    [Fact]
    public void GetClaimStatus_AfterThePayloadIsFetched_ReturnsNotFound()
    {
        var accountId = Guid.NewGuid();
        var issuer = new DevicePairingIssuer();
        var session = issuer.Create(accountId, PrimaryPublicKey);
        issuer.Claim(session.SessionId, NewDevicePublicKey);
        issuer.SubmitPayload(session.SessionId, accountId, EncryptedKek);
        issuer.FetchPayload(session.SessionId);

        var status = issuer.GetClaimStatus(session.SessionId, accountId);

        Assert.False(status.Succeeded);
        Assert.Equal(PairingClaimStatusFailureReason.NotFound, status.FailureReason);
    }
}
