using Api.Data;
using Api.PatientLinks;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.PatientLinks;

/// <summary>
/// S11-04 fatia 2: convites de uso único, vínculos, envelopes e o CAS de preferências, relógio
/// injetado. Preferências (S11-03 fatia 8) e convites/vínculos (fatia 9) falam Postgres real
/// (Testcontainers) -- exactly-one-wins deixou de ser um lock de processo, tem de correr contra
/// conexões de verdade, mesmo molde de AccountKeyPairServiceTests. Envelopes continuam em
/// memória até à fatia 10 (lote 3), por isso os testes de Share/ListShared abaixo não tocam o
/// container -- só criam um store contra ele e exercitam os dicionários internos.
/// </summary>
[Collection("Database")]
public sealed class PatientLinkStoreTests : IAsyncLifetime
{
    private static readonly Guid ProfessionalId = Guid.NewGuid();
    private static readonly Guid PatientId = Guid.NewGuid();
    private static readonly Guid PatientAccountId = Guid.NewGuid();

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;
    private NpgsqlDataSource _dataSource = null!;

    public PatientLinkStoreTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    public async Task InitializeAsync()
    {
        await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await adminConnection.OpenAsync();

        _respawner = await Respawner.CreateAsync(adminConnection, new RespawnerOptions
        {
            SchemasToInclude = ["public"],
            DbAdapter = DbAdapter.Postgres,
        });
        await _respawner.ResetAsync(adminConnection);

        _dataSource = NpgsqlDataSourceFactory.Create(_fixture.AppRoleConnectionString);
    }

    public async Task DisposeAsync() => await _dataSource.DisposeAsync();

    [Fact]
    public void Redeem_SameCodeTwice_SecondIsInviteNotFound()
    {
        var store = new PatientLinkStore(_dataSource);
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
        var store = new PatientLinkStore(_dataSource, () => now);

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
        var store = new PatientLinkStore(_dataSource, () => clock);
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        clock = now + PatientLinkStore.InviteLifetime;

        var result = store.Redeem(invite.Code, PatientAccountId);

        var failure = result.Match(_ => (RedeemFailure?)null, f => f);
        Assert.Equal(RedeemFailure.InviteNotFound, failure);
    }

    [Fact]
    public void Redeem_UnknownCode_IsInviteNotFound()
    {
        var store = new PatientLinkStore(_dataSource);

        var result = store.Redeem("NOTACODE1234", PatientAccountId);

        var failure = result.Match(_ => (RedeemFailure?)null, f => f);
        Assert.Equal(RedeemFailure.InviteNotFound, failure);
    }

    [Fact]
    public void Redeem_TwoConcurrentAttemptsOnSameCode_ExactlyOneWins()
    {
        var store = new PatientLinkStore(_dataSource);
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
        var store = new PatientLinkStore(_dataSource);
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
        var store = new PatientLinkStore(_dataSource);
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
        var store = new PatientLinkStore(_dataSource);
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
        var store = new PatientLinkStore(_dataSource);
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
        var store = new PatientLinkStore(_dataSource);

        Assert.Empty(store.ListFor(Guid.NewGuid()));
    }

    [Fact]
    public void Unlink_ByEitherParty_RemovesTheLinkAndAllowsRelinkingWithANewCode()
    {
        var store = new PatientLinkStore(_dataSource);
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
        var store = new PatientLinkStore(_dataSource);

        Assert.False(store.Unlink(ProfessionalId, PatientAccountId));
    }

    /// <summary>The professional side initiating unlink (accountId=professional, peerAccountId=patient) is the other order than Unlink_ByEitherParty_..., which unlinks from the patient side.</summary>
    [Fact]
    public void Unlink_InitiatedByProfessional_RemovesTheLink()
    {
        var store = new PatientLinkStore(_dataSource);
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
        var store = new PatientLinkStore(_dataSource);
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
        var store = new PatientLinkStore(_dataSource);
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(invite.Code, PatientAccountId);

        var unlinked = store.Unlink(ProfessionalId, Guid.NewGuid());

        Assert.False(unlinked);
    }

    /// <summary>peerAccountId matches the link's professional side, but accountId does not match its patient side -- a half-match on the second (professional, patient) pair still returns false.</summary>
    [Fact]
    public void Unlink_WhenPeerMatchesProfessionalButAccountDoesNotMatchPatient_ReturnsFalse()
    {
        var store = new PatientLinkStore(_dataSource);
        var invite = store.CreateInvite(ProfessionalId, PatientId);
        store.Redeem(invite.Code, PatientAccountId);

        var unlinked = store.Unlink(Guid.NewGuid(), ProfessionalId);

        Assert.False(unlinked);
    }

    [Fact]
    public void Share_WhenNoLinkExists_ReturnsFalse()
    {
        var store = new PatientLinkStore(_dataSource);

        Assert.False(store.Share(PatientAccountId, ProfessionalId, SomeCiphertext()));
    }

    [Fact]
    public void ListShared_WhenNoLinkExists_ReturnsNull()
    {
        var store = new PatientLinkStore(_dataSource);

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
    public async Task GetPreferencesAsync_WhenNeverSaved_ReturnsNull()
    {
        var store = new PatientLinkStore(_dataSource);

        Assert.Null(await store.GetPreferencesAsync(Guid.NewGuid(), CancellationToken.None));
    }

    [Fact]
    public async Task PutPreferencesAsync_WithExpectedVersionZero_CreatesVersion1()
    {
        var store = new PatientLinkStore(_dataSource);
        var accountId = await SeedAccountAsync("prefs-create@example.com");

        var result = await store.PutPreferencesAsync(accountId, 0, SomeCiphertext(0xA0), SomeCiphertext(0xA1), CancellationToken.None);

        Assert.True(result.TryGetValue(out var preferences));
        Assert.Equal(1, preferences!.Version);
        // Assert.Equivalent (not Equal): byte[] is not IEquatable, so record equality on
        // SharingPreferences falls back to reference equality -- same gap fatia 6 hit on
        // PostgresAccountStoreTests round-trips.
        Assert.Equivalent(preferences, await store.GetPreferencesAsync(accountId, CancellationToken.None));
    }

    [Fact]
    public async Task PutPreferencesAsync_WithStaleExpectedVersion_ReturnsCurrentVersionAsFailure()
    {
        var store = new PatientLinkStore(_dataSource);
        var accountId = await SeedAccountAsync("prefs-stale@example.com");
        await store.PutPreferencesAsync(accountId, 0, SomeCiphertext(0xA0), SomeCiphertext(0xA1), CancellationToken.None);

        var result = await store.PutPreferencesAsync(accountId, 0, SomeCiphertext(0xB0), SomeCiphertext(0xB1), CancellationToken.None);

        var failure = result.Match(_ => (long?)null, currentVersion => currentVersion);
        Assert.Equal(1, failure);
        Assert.Equal(1, (await store.GetPreferencesAsync(accountId, CancellationToken.None))!.Version);
    }

    [Fact]
    public async Task PutPreferencesAsync_ConcurrentSameExpectedVersion_ExactlyOneWins()
    {
        var store = new PatientLinkStore(_dataSource);
        var accountId = await SeedAccountAsync("prefs-race@example.com");
        var successCount = 0;

        await Task.WhenAll(Enumerable.Range(0, 20).Select(i => Task.Run(async () =>
        {
            var result = await store.PutPreferencesAsync(accountId, 0, SomeCiphertext((byte)i), SomeCiphertext((byte)i), CancellationToken.None);
            if (result.TryGetValue(out _))
            {
                Interlocked.Increment(ref successCount);
            }
        })));

        Assert.Equal(1, successCount);
        Assert.Equal(1, (await store.GetPreferencesAsync(accountId, CancellationToken.None))!.Version);
    }

    /// <summary>sharing_preferences.account_id has an FK to accounts -- unlike the still-in-memory invite/link/shared-item tests, the CAS tests need a real row.</summary>
    private async Task<Guid> SeedAccountAsync(string email)
    {
        var accountId = Guid.NewGuid();
        var accountStore = new Api.Accounts.PostgresAccountStore(_dataSource, new Api.Accounts.TotpSecretCipher(new byte[32]));
        await accountStore.InsertAsync(
            new Api.Accounts.Account(accountId, email, Api.Accounts.AccountRole.Patient, PasswordVerifier: null, GoogleSubjectId: null),
            CancellationToken.None);
        return accountId;
    }

    private PatientLinkStore LinkedStore()
    {
        var store = new PatientLinkStore(_dataSource);
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
