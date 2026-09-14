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

    [Fact]
    public void Share_WhenNoLinkExists_ReturnsFalse()
    {
        var store = new PatientLinkStore();

        Assert.False(store.Share(PatientAccountId, ProfessionalId, SomeCiphertext()));
    }

    [Fact]
    public void ListShared_WhenNoLinkExists_ReturnsNull()
    {
        var store = new PatientLinkStore();

        Assert.Null(store.ListShared(ProfessionalId, PatientAccountId));
    }

    [Fact]
    public void ListShared_WhenLinkedButNothingShared_ReturnsEmpty()
    {
        var store = LinkedStore();

        Assert.Empty(store.ListShared(ProfessionalId, PatientAccountId)!);
    }

    [Fact]
    public void Share_ThenListShared_ReturnsItemsInArrivalOrder()
    {
        var store = LinkedStore();
        var first = SomeCiphertext(0x01);
        var second = SomeCiphertext(0x02);

        Assert.True(store.Share(PatientAccountId, ProfessionalId, first));
        Assert.True(store.Share(PatientAccountId, ProfessionalId, second));
        var items = store.ListShared(ProfessionalId, PatientAccountId);

        Assert.Equal(2, items!.Count);
        Assert.Equal(first, items[0].Ciphertext);
        Assert.Equal(second, items[1].Ciphertext);
    }

    /// <summary>Direction matters: Share only succeeds with accountId as the patient side. A professional cannot Share into her own inbox.</summary>
    [Fact]
    public void Share_WithSidesSwapped_ReturnsFalse()
    {
        var store = LinkedStore();

        Assert.False(store.Share(ProfessionalId, PatientAccountId, SomeCiphertext()));
    }

    [Fact]
    public void Unlink_KeepsSharedItems_RelinkListsThem()
    {
        var store = LinkedStore();
        store.Share(PatientAccountId, ProfessionalId, SomeCiphertext());

        store.Unlink(PatientAccountId, ProfessionalId);
        Assert.Null(store.ListShared(ProfessionalId, PatientAccountId));

        var newInvite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(newInvite.Code, PatientAccountId);

        Assert.Single(store.ListShared(ProfessionalId, PatientAccountId)!);
    }

    [Fact]
    public void GetPreferences_WhenNeverSaved_ReturnsNull()
    {
        var store = new PatientLinkStore();

        Assert.Null(store.GetPreferences(Guid.NewGuid()));
    }

    [Fact]
    public void PutPreferences_WithExpectedVersionZero_CreatesVersion1()
    {
        var store = new PatientLinkStore();
        var accountId = Guid.NewGuid();

        var result = store.PutPreferences(accountId, 0, SomeCiphertext(0xA0), SomeCiphertext(0xA1));

        Assert.True(result.TryGetValue(out var preferences));
        Assert.Equal(1, preferences!.Version);
        Assert.Equal(preferences, store.GetPreferences(accountId));
    }

    [Fact]
    public void PutPreferences_WithStaleExpectedVersion_ReturnsCurrentVersionAsFailure()
    {
        var store = new PatientLinkStore();
        var accountId = Guid.NewGuid();
        store.PutPreferences(accountId, 0, SomeCiphertext(0xA0), SomeCiphertext(0xA1));

        var result = store.PutPreferences(accountId, 0, SomeCiphertext(0xB0), SomeCiphertext(0xB1));

        var failure = result.Match(_ => (long?)null, currentVersion => currentVersion);
        Assert.Equal(1, failure);
        Assert.Equal(1, store.GetPreferences(accountId)!.Version);
    }

    [Fact]
    public void PutPreferences_ConcurrentSameExpectedVersion_ExactlyOneWins()
    {
        var store = new PatientLinkStore();
        var accountId = Guid.NewGuid();
        var successCount = 0;

        Parallel.For(0, 20, i =>
        {
            var result = store.PutPreferences(accountId, 0, SomeCiphertext((byte)i), SomeCiphertext((byte)i));
            if (result.TryGetValue(out _))
            {
                Interlocked.Increment(ref successCount);
            }
        });

        Assert.Equal(1, successCount);
        Assert.Equal(1, store.GetPreferences(accountId)!.Version);
    }

    private static PatientLinkStore LinkedStore()
    {
        var store = new PatientLinkStore();
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(invite.Code, PatientAccountId);
        return store;
    }

    private static byte[] SomeCiphertext(byte fill = 0x01)
    {
        var blob = new byte[28];
        Array.Fill(blob, fill);
        return blob;
    }
}
