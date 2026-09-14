using Api.PatientLinks;

namespace Api.Tests.PatientLinks;

/// <summary>
/// S11-04 fatia 2: convites de uso único e vínculos em memória, relógio injetado -- sem Docker,
/// sem HTTP. Molde de injeção de relógio: DevicePairingIssuerTests.
/// </summary>
public sealed class PatientLinkStoreTests
{
    private static readonly Guid ProfessionalId = Guid.NewGuid();
    private static readonly Guid PatientId = Guid.NewGuid();
    private static readonly Guid PatientAccountId = Guid.NewGuid();

    [Fact]
    public void Redeem_SameCodeTwice_SecondIsInviteNotFound()
    {
        var store = new PatientLinkStore();
        var invite = store.CreateInvite(ProfessionalId, PatientId);

        var first = store.Redeem(invite.Code, PatientAccountId);
        Assert.True(first.TryGetValue(out _));

        var second = store.Redeem(invite.Code, Guid.NewGuid());
        var secondFailed = second.Match(_ => (RedeemFailure?)null, failure => failure);
        Assert.Equal(RedeemFailure.InviteNotFound, secondFailed);
    }

    [Fact]
    public void CreateInvite_ReturnsA12CharacterCodeAndSevenDayExpiry()
    {
        var now = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var store = new PatientLinkStore(() => now);

        var invite = store.CreateInvite(ProfessionalId, PatientId);

        Assert.Equal(12, invite.Code.Length);
        Assert.Equal(ProfessionalId, invite.ProfessionalAccountId);
        Assert.Equal(PatientId, invite.PatientId);
        Assert.Equal(now + PatientLinkStore.InviteLifetime, invite.ExpiresAt);
        Assert.Equal(TimeSpan.FromDays(7), PatientLinkStore.InviteLifetime);
    }

    [Fact]
    public void Redeem_AfterExpiry_IsInviteNotFound()
    {
        var now = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var clock = now;
        var store = new PatientLinkStore(() => clock);
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        clock = now + PatientLinkStore.InviteLifetime;

        var result = store.Redeem(invite.Code, PatientAccountId);

        var failure = result.Match(_ => (RedeemFailure?)null, f => f);
        Assert.Equal(RedeemFailure.InviteNotFound, failure);
    }

    [Fact]
    public void Redeem_UnknownCode_IsInviteNotFound()
    {
        var store = new PatientLinkStore();

        var result = store.Redeem("NOTACODE1234", PatientAccountId);

        var failure = result.Match(_ => (RedeemFailure?)null, f => f);
        Assert.Equal(RedeemFailure.InviteNotFound, failure);
    }

    [Fact]
    public void Redeem_TwoConcurrentAttemptsOnSameCode_ExactlyOneWins()
    {
        var store = new PatientLinkStore();
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        var successCount = 0;

        Parallel.For(0, 20, i =>
        {
            var result = store.Redeem(invite.Code, PatientAccountId);
            if (result.TryGetValue(out _))
            {
                Interlocked.Increment(ref successCount);
            }
        });

        Assert.Equal(1, successCount);
    }

    [Fact]
    public void Redeem_WhenAlreadyLinkedToSamePatientAccount_IsAlreadyLinked()
    {
        var store = new PatientLinkStore();
        var firstInvite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(firstInvite.Code, PatientAccountId);
        var secondInvite = store.CreateInvite(ProfessionalId, Guid.NewGuid());

        var result = store.Redeem(secondInvite.Code, PatientAccountId);

        var failure = result.Match(_ => (RedeemFailure?)null, f => f);
        Assert.Equal(RedeemFailure.AlreadyLinked, failure);
    }

    [Fact]
    public void Redeem_WhenSamePatientIdAlreadyLinkedToADifferentAccount_IsAlreadyLinked()
    {
        var store = new PatientLinkStore();
        var firstInvite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(firstInvite.Code, PatientAccountId);
        var secondInvite = store.CreateInvite(ProfessionalId, PatientId);

        var result = store.Redeem(secondInvite.Code, Guid.NewGuid());

        var failure = result.Match(_ => (RedeemFailure?)null, f => f);
        Assert.Equal(RedeemFailure.AlreadyLinked, failure);
    }

    /// <summary>A different professional inviting the same patient never conflicts -- the "already linked" check is scoped to (professional, patient), not to the patient alone.</summary>
    [Fact]
    public void Redeem_ForADifferentProfessional_SucceedsEvenThoughPatientIsAlreadyLinkedElsewhere()
    {
        var store = new PatientLinkStore();
        var firstInvite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(firstInvite.Code, PatientAccountId);
        var otherProfessionalId = Guid.NewGuid();
        var secondInvite = store.CreateInvite(otherProfessionalId, Guid.NewGuid());

        var result = store.Redeem(secondInvite.Code, PatientAccountId);

        Assert.True(result.TryGetValue(out _));
    }

    [Fact]
    public void ListFor_ReturnsLinksForEitherProfessionalOrPatientSide()
    {
        var store = new PatientLinkStore();
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(invite.Code, PatientAccountId);

        var professionalSide = store.ListFor(ProfessionalId);
        var patientSide = store.ListFor(PatientAccountId);

        Assert.Single(professionalSide);
        Assert.Single(patientSide);
        Assert.Equal(professionalSide[0], patientSide[0]);
    }

    [Fact]
    public void ListFor_UnknownAccount_ReturnsEmpty()
    {
        var store = new PatientLinkStore();

        Assert.Empty(store.ListFor(Guid.NewGuid()));
    }

    [Fact]
    public void Unlink_ByEitherParty_RemovesTheLinkAndAllowsRelinkingWithANewCode()
    {
        var store = new PatientLinkStore();
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(invite.Code, PatientAccountId);

        var unlinked = store.Unlink(PatientAccountId, ProfessionalId);

        Assert.True(unlinked);
        Assert.Empty(store.ListFor(ProfessionalId));
        Assert.Empty(store.ListFor(PatientAccountId));

        var newInvite = store.CreateInvite(ProfessionalId, PatientId);
        var relinked = store.Redeem(newInvite.Code, PatientAccountId);
        Assert.True(relinked.TryGetValue(out _));
    }

    [Fact]
    public void Unlink_WhenNoLinkExists_ReturnsFalse()
    {
        var store = new PatientLinkStore();

        Assert.False(store.Unlink(ProfessionalId, PatientAccountId));
    }

    /// <summary>The professional side initiating unlink (accountId=professional, peerAccountId=patient) is the other order than Unlink_ByEitherParty_..., which unlinks from the patient side.</summary>
    [Fact]
    public void Unlink_InitiatedByProfessional_RemovesTheLink()
    {
        var store = new PatientLinkStore();
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(invite.Code, PatientAccountId);

        var unlinked = store.Unlink(ProfessionalId, PatientAccountId);

        Assert.True(unlinked);
        Assert.Empty(store.ListFor(ProfessionalId));
    }

    /// <summary>An unrelated pair of ids against a non-empty link list still returns false -- neither side of the one existing link matches, so FindIndex never claims a hit.</summary>
    [Fact]
    public void Unlink_WithUnrelatedAccountsWhileAnotherLinkExists_ReturnsFalse()
    {
        var store = new PatientLinkStore();
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(invite.Code, PatientAccountId);

        var unlinked = store.Unlink(Guid.NewGuid(), Guid.NewGuid());

        Assert.False(unlinked);
        Assert.Single(store.ListFor(ProfessionalId));
    }

    /// <summary>accountId matches the link's professional side, but peerAccountId does not match its patient side -- a half-match on the first (professional, patient) pair still returns false.</summary>
    [Fact]
    public void Unlink_WhenAccountMatchesProfessionalButPeerDoesNotMatchPatient_ReturnsFalse()
    {
        var store = new PatientLinkStore();
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(invite.Code, PatientAccountId);

        var unlinked = store.Unlink(ProfessionalId, Guid.NewGuid());

        Assert.False(unlinked);
    }

    /// <summary>peerAccountId matches the link's professional side, but accountId does not match its patient side -- a half-match on the second (professional, patient) pair still returns false.</summary>
    [Fact]
    public void Unlink_WhenPeerMatchesProfessionalButAccountDoesNotMatchPatient_ReturnsFalse()
    {
        var store = new PatientLinkStore();
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(invite.Code, PatientAccountId);

        var unlinked = store.Unlink(Guid.NewGuid(), ProfessionalId);

        Assert.False(unlinked);
    }
}
