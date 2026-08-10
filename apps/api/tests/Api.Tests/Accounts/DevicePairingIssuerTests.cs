using Api.Accounts;

namespace Api.Tests.Accounts;

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

    // A replayed claim must be indistinguishable from a made-up session id, so this returns
    // NotFound, not an "already claimed" tell.
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

    // Polled in a loop by the primary device, so unlike Claim/FetchPayload this must not
    // consume anything.
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

    // A session polled by a non-owning account must look identical to a nonexistent one, or
    // polling becomes an oracle that leaks the claiming device's public key.
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

    // Same anti-enumeration discipline as GetClaimStatus_WithAnotherAccountsId_ReturnsNotFound:
    // reported as NotFound, not a distinct "not yours".
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

    // Reported with the same code as a made-up session id, so polling can never confirm a
    // session exists.
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

    // The wrapped KEK is handed over exactly once, even to the legitimate device retrying;
    // a captured session id can never be redeemed for key material twice.
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

    // A consumed session is gone for every surface, not just FetchPayload: the primary's
    // poll must stop resolving it too.
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
