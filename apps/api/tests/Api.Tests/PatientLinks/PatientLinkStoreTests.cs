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
    public async Task RedeemAsync_SameCodeTwice_SecondIsInviteNotFound()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);

        var first = await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);
        Assert.True(first.TryGetValue(out _));

        var second = await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);
        var secondFailed = second.Match(_ => (RedeemFailure?)null, failure => failure);
        Assert.Equal(RedeemFailure.InviteNotFound, secondFailed);
    }

    [Fact]
    public async Task ListForWithPeerKeyAsync_WithoutPublishedPeerKey_ReturnsNullKey()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);

        var links = await store.ListForWithPeerKeyAsync(PatientAccountId, CancellationToken.None);

        Assert.Single(links);
        Assert.Null(links[0].PeerPublicKey);
    }

    [Fact]
    public async Task RedeemWithPeerKeyAsync_WithUnknownCode_ReturnsInviteNotFound()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(PatientAccountId);

        var result = await store.RedeemWithPeerKeyAsync("UNKNOWN-CODE", PatientAccountId, CancellationToken.None);

        var failure = result.Match(_ => (RedeemFailure?)null, value => value);
        Assert.Equal(RedeemFailure.InviteNotFound, failure);
    }

    [Fact]
    public async Task CreateInviteAsync_ReturnsA12CharacterCodeAndSevenDayExpiry()
    {
        var now = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var store = new PatientLinkStore(_dataSource, () => now);
        await SeedAccountsAsync(ProfessionalId);

        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);

        Assert.Equal(12, invite.Code.Length);
        Assert.Equal(ProfessionalId, invite.ProfessionalAccountId);
        Assert.Equal(PatientId, invite.PatientId);
        Assert.Equal(now + PatientLinkStore.InviteLifetime, invite.ExpiresAt);
        Assert.Equal(TimeSpan.FromDays(7), PatientLinkStore.InviteLifetime);
    }

    [Fact]
    public async Task RedeemAsync_AfterExpiry_IsInviteNotFound()
    {
        var now = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var clock = now;
        var store = new PatientLinkStore(_dataSource, () => clock);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        clock = now + PatientLinkStore.InviteLifetime;

        var result = await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);

        var failure = result.Match(_ => (RedeemFailure?)null, f => f);
        Assert.Equal(RedeemFailure.InviteNotFound, failure);
    }

    [Fact]
    public async Task RedeemAsync_UnknownCode_IsInviteNotFound()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(PatientAccountId);

        var result = await store.RedeemAsync("NOTACODE1234", PatientAccountId, CancellationToken.None);

        var failure = result.Match(_ => (RedeemFailure?)null, f => f);
        Assert.Equal(RedeemFailure.InviteNotFound, failure);
    }

    [Fact]
    public async Task RedeemAsync_TwoConcurrentAttemptsOnSameCode_ExactlyOneWins()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        var successCount = 0;

        await Task.WhenAll(Enumerable.Range(0, 20).Select(i => Task.Run(async () =>
        {
            var result = await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);
            if (result.TryGetValue(out _))
            {
                Interlocked.Increment(ref successCount);
            }
        })));

        Assert.Equal(1, successCount);
    }

    [Fact]
    public async Task RedeemAsync_WhenAlreadyLinkedToSamePatientAccount_IsAlreadyLinked()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var firstInvite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(firstInvite.Code, PatientAccountId, CancellationToken.None);
        var secondInvite = await store.CreateInviteAsync(ProfessionalId, Guid.NewGuid(), CancellationToken.None);

        var result = await store.RedeemAsync(secondInvite.Code, PatientAccountId, CancellationToken.None);

        var failure = result.Match(_ => (RedeemFailure?)null, f => f);
        Assert.Equal(RedeemFailure.AlreadyLinked, failure);
    }

    [Fact]
    public async Task RedeemAsync_WhenSamePatientIdAlreadyLinkedToADifferentAccount_IsAlreadyLinked()
    {
        var store = new PatientLinkStore(_dataSource);
        var otherPatientAccountId = Guid.NewGuid();
        await SeedAccountsAsync(ProfessionalId, PatientAccountId, otherPatientAccountId);
        var firstInvite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(firstInvite.Code, PatientAccountId, CancellationToken.None);
        var secondInvite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);

        var result = await store.RedeemAsync(secondInvite.Code, otherPatientAccountId, CancellationToken.None);

        var failure = result.Match(_ => (RedeemFailure?)null, f => f);
        Assert.Equal(RedeemFailure.AlreadyLinked, failure);
    }

    /// <summary>A different professional inviting the same patient never conflicts -- the "already linked" check is scoped to (professional, patient), not to the patient alone.</summary>
    [Fact]
    public async Task RedeemAsync_ForADifferentProfessional_SucceedsEvenThoughPatientIsAlreadyLinkedElsewhere()
    {
        var store = new PatientLinkStore(_dataSource);
        var otherProfessionalId = Guid.NewGuid();
        await SeedAccountsAsync(ProfessionalId, PatientAccountId, otherProfessionalId);
        var firstInvite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(firstInvite.Code, PatientAccountId, CancellationToken.None);
        var secondInvite = await store.CreateInviteAsync(otherProfessionalId, Guid.NewGuid(), CancellationToken.None);

        var result = await store.RedeemAsync(secondInvite.Code, PatientAccountId, CancellationToken.None);

        Assert.True(result.TryGetValue(out _));
    }

    [Fact]
    public async Task ListForAsync_ReturnsLinksForEitherProfessionalOrPatientSide()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);

        var professionalSide = await store.ListForAsync(ProfessionalId, CancellationToken.None);
        var patientSide = await store.ListForAsync(PatientAccountId, CancellationToken.None);

        Assert.Single(professionalSide);
        Assert.Single(patientSide);
        Assert.Equal(professionalSide[0], patientSide[0]);
    }

    [Fact]
    public async Task ListForAsync_ExcludesUnlinked()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);

        await store.UnlinkAsync(PatientAccountId, ProfessionalId, CancellationToken.None);

        Assert.Empty(await store.ListForAsync(ProfessionalId, CancellationToken.None));
        Assert.Empty(await store.ListForAsync(PatientAccountId, CancellationToken.None));
    }

    [Fact]
    public async Task ListForAsync_UnknownAccount_ReturnsEmpty()
    {
        var store = new PatientLinkStore(_dataSource);

        Assert.Empty(await store.ListForAsync(Guid.NewGuid(), CancellationToken.None));
    }

    [Fact]
    public async Task UnlinkAsync_ByEitherParty_RemovesTheLinkAndAllowsRelinkingWithANewCode()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);

        var unlinked = await store.UnlinkAsync(PatientAccountId, ProfessionalId, CancellationToken.None);

        Assert.True(unlinked);
        Assert.Empty(await store.ListForAsync(ProfessionalId, CancellationToken.None));
        Assert.Empty(await store.ListForAsync(PatientAccountId, CancellationToken.None));

        var newInvite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        var relinked = await store.RedeemAsync(newInvite.Code, PatientAccountId, CancellationToken.None);
        Assert.True(relinked.TryGetValue(out _));
    }

    [Fact]
    public async Task UnlinkAsync_WhenNoLinkExists_ReturnsFalse()
    {
        var store = new PatientLinkStore(_dataSource);

        Assert.False(await store.UnlinkAsync(ProfessionalId, PatientAccountId, CancellationToken.None));
    }

    /// <summary>The professional side initiating unlink (accountId=professional, peerAccountId=patient) is the other order than UnlinkAsync_ByEitherParty_..., which unlinks from the patient side.</summary>
    [Fact]
    public async Task UnlinkAsync_InitiatedByProfessional_RemovesTheLink()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);

        var unlinked = await store.UnlinkAsync(ProfessionalId, PatientAccountId, CancellationToken.None);

        Assert.True(unlinked);
        Assert.Empty(await store.ListForAsync(ProfessionalId, CancellationToken.None));
    }

    /// <summary>An unrelated pair of ids against a non-empty link list still returns false -- neither side of the one existing link matches, so no row is affected.</summary>
    [Fact]
    public async Task UnlinkAsync_WithUnrelatedAccountsWhileAnotherLinkExists_ReturnsFalse()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);

        var unlinked = await store.UnlinkAsync(Guid.NewGuid(), Guid.NewGuid(), CancellationToken.None);

        Assert.False(unlinked);
        Assert.Single(await store.ListForAsync(ProfessionalId, CancellationToken.None));
    }

    /// <summary>accountId matches the link's professional side, but peerAccountId does not match its patient side -- a half-match on the first (professional, patient) pair still returns false.</summary>
    [Fact]
    public async Task UnlinkAsync_WhenAccountMatchesProfessionalButPeerDoesNotMatchPatient_ReturnsFalse()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);

        var unlinked = await store.UnlinkAsync(ProfessionalId, Guid.NewGuid(), CancellationToken.None);

        Assert.False(unlinked);
    }

    /// <summary>peerAccountId matches the link's professional side, but accountId does not match its patient side -- a half-match on the second (professional, patient) pair still returns false.</summary>
    [Fact]
    public async Task UnlinkAsync_WhenPeerMatchesProfessionalButAccountDoesNotMatchPatient_ReturnsFalse()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);

        var unlinked = await store.UnlinkAsync(Guid.NewGuid(), ProfessionalId, CancellationToken.None);

        Assert.False(unlinked);
    }

    [Fact]
    public async Task ShareAsync_WhenNoLinkExists_ReturnsFalse()
    {
        var store = new PatientLinkStore(_dataSource);

        Assert.False(await store.ShareAsync(PatientAccountId, ProfessionalId, SomeCiphertext(), CancellationToken.None));
    }

    [Fact]
    public async Task ListSharedAsync_WhenNoLinkExists_ReturnsNull()
    {
        var store = new PatientLinkStore(_dataSource);

        Assert.Null(await store.ListSharedAsync(ProfessionalId, PatientAccountId, CancellationToken.None));
    }

    [Fact]
    public async Task ListSharedAsync_WhenLinkedButNothingShared_ReturnsEmpty()
    {
        var store = await LinkedStoreAsync();

        Assert.Empty((await store.ListSharedAsync(ProfessionalId, PatientAccountId, CancellationToken.None))!);
    }

    [Fact]
    public async Task ShareAsync_ThenListSharedAsync_ReturnsItemsInArrivalOrder()
    {
        var store = await LinkedStoreAsync();
        var first = SomeCiphertext(0x01);
        var second = SomeCiphertext(0x02);

        Assert.True(await store.ShareAsync(PatientAccountId, ProfessionalId, first, CancellationToken.None));
        Assert.True(await store.ShareAsync(PatientAccountId, ProfessionalId, second, CancellationToken.None));
        var items = await store.ListSharedAsync(ProfessionalId, PatientAccountId, CancellationToken.None);

        Assert.Equal(2, items!.Count);
        Assert.Equal(first, items[0].Ciphertext);
        Assert.Equal(second, items[1].Ciphertext);
    }

    /// <summary>Direction matters: Share only succeeds with accountId as the patient side. A professional cannot Share into her own inbox.</summary>
    [Fact]
    public async Task ShareAsync_WithSidesSwapped_ReturnsFalse()
    {
        var store = await LinkedStoreAsync();

        Assert.False(await store.ShareAsync(ProfessionalId, PatientAccountId, SomeCiphertext(), CancellationToken.None));
    }

    [Fact]
    public async Task UnlinkAsync_KeepsSharedItems_RelinkListsThem()
    {
        var store = await LinkedStoreAsync();
        await store.ShareAsync(PatientAccountId, ProfessionalId, SomeCiphertext(), CancellationToken.None);

        await store.UnlinkAsync(PatientAccountId, ProfessionalId, CancellationToken.None);
        Assert.Null(await store.ListSharedAsync(ProfessionalId, PatientAccountId, CancellationToken.None));

        var newInvite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(newInvite.Code, PatientAccountId, CancellationToken.None);

        Assert.Single((await store.ListSharedAsync(ProfessionalId, PatientAccountId, CancellationToken.None))!);
    }

    /// <summary>S11-03 fatia 10: ShareAsync now checks the active link and inserts in the same statement, so a link already soft-unlinked before the call is exactly the same as never having linked -- no envelope is appended.</summary>
    [Fact]
    public async Task ShareAsync_AfterUnlink_ReturnsFalse()
    {
        var store = await LinkedStoreAsync();
        await store.UnlinkAsync(PatientAccountId, ProfessionalId, CancellationToken.None);

        Assert.False(await store.ShareAsync(PatientAccountId, ProfessionalId, SomeCiphertext(), CancellationToken.None));
    }

    /// <summary>
    /// Proves the atomicity claimed on ShareAsync's doc comment: whichever of Share/Unlink commits
    /// first wins the FOR SHARE lock on the patient_links row, so the two transactions serialize
    /// instead of interleaving. The invariant checked here does not depend on which one wins --
    /// only that no envelope's shared_at ever lands after the link's unlinked_at, which the old
    /// in-memory-dictionary implementation could not guarantee (see the README's now-removed
    /// ponytail note).
    /// </summary>
    [Fact]
    public async Task ShareAsync_ConcurrentWithUnlink_NeverInsertsAnEnvelopeAfterUnlinkedAt()
    {
        var store = await LinkedStoreAsync();

        var shareTasks = Enumerable.Range(0, 20)
            .Select(i => Task.Run(() => store.ShareAsync(PatientAccountId, ProfessionalId, SomeCiphertext((byte)i), CancellationToken.None)))
            .ToArray();
        var unlinkTask = Task.Run(() => store.UnlinkAsync(PatientAccountId, ProfessionalId, CancellationToken.None));

        await Task.WhenAll(shareTasks.Cast<Task>().Append(unlinkTask));

        var receivedShares = await store.ListReceivedSharesAsync(ProfessionalId, CancellationToken.None);
        var share = Assert.Single(receivedShares);
        if (share.UnlinkedAt is { } unlinkedAt)
        {
            Assert.All(share.Items, item => Assert.True(item.SharedAt <= unlinkedAt));
        }
    }

    [Fact]
    public async Task ListReceivedSharesAsync_WhenNeverLinkedToAnyone_ReturnsEmpty()
    {
        var store = new PatientLinkStore(_dataSource);

        Assert.Empty(await store.ListReceivedSharesAsync(ProfessionalId, CancellationToken.None));
    }

    /// <summary>The forma's fatia 10 red test: envelopes shared before the patient unlinks stay attached to the pair, and unlinkedAt reports when it happened -- this is exactly what GET shared-items 404s away, and why P6 reads this instead.</summary>
    [Fact]
    public async Task ListReceivedSharesAsync_AfterUnlink_ReturnsPriorItemsWithUnlinkedAt()
    {
        var clock = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var store = new PatientLinkStore(_dataSource, () => clock);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);
        var ciphertext = SomeCiphertext(0x0A);
        await store.ShareAsync(PatientAccountId, ProfessionalId, ciphertext, CancellationToken.None);

        clock = clock.AddDays(1);
        await store.UnlinkAsync(PatientAccountId, ProfessionalId, CancellationToken.None);

        var shares = await store.ListReceivedSharesAsync(ProfessionalId, CancellationToken.None);

        var share = Assert.Single(shares);
        Assert.Equal(PatientAccountId, share.PatientAccountId);
        Assert.Equal(PatientId, share.PatientId);
        Assert.Equal(clock, share.UnlinkedAt);
        var item = Assert.Single(share.Items);
        Assert.Equal(ciphertext, item.Ciphertext);
    }

    [Fact]
    public async Task ListReceivedSharesAsync_WhileStillLinked_ReturnsNullUnlinkedAt()
    {
        var store = await LinkedStoreAsync();

        var shares = await store.ListReceivedSharesAsync(ProfessionalId, CancellationToken.None);

        var share = Assert.Single(shares);
        Assert.Null(share.UnlinkedAt);
        Assert.Empty(share.Items);
    }

    [Fact]
    public async Task ListReceivedSharesAsync_IncludesPeerPublicKeyWhenPatientPublishedOne()
    {
        var store = await LinkedStoreAsync();
        var accountStore = new Api.Accounts.PostgresAccountStore(_dataSource, new Api.Accounts.TotpSecretCipher(new byte[32]));
        var keyPairs = new Api.Accounts.AccountKeyPairService(_dataSource);
        var publicKey = SomeBlob(0xAB, 32);
        await keyPairs.PublishAsync(
            PatientAccountId,
            new Api.Accounts.AccountKeyPair(publicKey, SomeCiphertext(0xB0), SomeCiphertext(0xB1)),
            CancellationToken.None);

        var shares = await store.ListReceivedSharesAsync(ProfessionalId, CancellationToken.None);

        var share = Assert.Single(shares);
        Assert.Equal(publicKey, share.PeerPublicKey);
    }

    [Fact]
    public async Task ListReceivedSharesAsync_ReturnsOneRowPerPatientEvenWithMultipleLinkCycles()
    {
        var store = await LinkedStoreAsync();
        await store.UnlinkAsync(PatientAccountId, ProfessionalId, CancellationToken.None);
        var newInvite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(newInvite.Code, PatientAccountId, CancellationToken.None);

        var shares = await store.ListReceivedSharesAsync(ProfessionalId, CancellationToken.None);

        var share = Assert.Single(shares);
        Assert.Null(share.UnlinkedAt);
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

        Assert.NotNull(result);
        Assert.Equal(1, result.Version);
        // Assert.Equivalent (not Equal): byte[] is not IEquatable, so record equality on
        // SharingPreferences falls back to reference equality -- same gap fatia 6 hit on
        // PostgresAccountStoreTests round-trips.
        Assert.Equivalent(result, await store.GetPreferencesAsync(accountId, CancellationToken.None));
    }

    [Fact]
    public async Task PutPreferencesAsync_WithStaleExpectedVersion_ReturnsCurrentVersionAsFailure()
    {
        var store = new PatientLinkStore(_dataSource);
        var accountId = await SeedAccountAsync("prefs-stale@example.com");
        await store.PutPreferencesAsync(accountId, 0, SomeCiphertext(0xA0), SomeCiphertext(0xA1), CancellationToken.None);

        var result = await store.PutPreferencesAsync(accountId, 0, SomeCiphertext(0xB0), SomeCiphertext(0xB1), CancellationToken.None);

        Assert.Null(result);
        Assert.Equal(1, (await store.GetPreferencesAsync(accountId, CancellationToken.None))!.Version);
    }

    /// <summary>Coverage gap left by fatia 8: expectedVersion > 0 with a row that was never saved is the only path where ReadCurrentPreferencesVersionAsync's ExecuteScalarAsync returns null (ternary's `: 0` arm).</summary>
    [Fact]
    public async Task PutPreferencesAsync_WithNonZeroExpectedVersionButNeverSaved_ReturnsZeroAsFailure()
    {
        var store = new PatientLinkStore(_dataSource);
        var accountId = await SeedAccountAsync("prefs-never-saved-nonzero@example.com");

        var result = await store.PutPreferencesAsync(accountId, 5, SomeCiphertext(0xA0), SomeCiphertext(0xA1), CancellationToken.None);

        Assert.Null(result);
    }

    /// <summary>Coverage gap left by fatia 8: every other PutPreferencesAsync test only ever passes expectedVersion 0, so the UPDATE branch (expectedVersion > 0, the row already exists) never ran.</summary>
    [Fact]
    public async Task PutPreferencesAsync_WithCorrectNonZeroExpectedVersion_AdvancesVersion()
    {
        var store = new PatientLinkStore(_dataSource);
        var accountId = await SeedAccountAsync("prefs-advance@example.com");
        await store.PutPreferencesAsync(accountId, 0, SomeCiphertext(0xA0), SomeCiphertext(0xA1), CancellationToken.None);

        var result = await store.PutPreferencesAsync(accountId, 1, SomeCiphertext(0xB0), SomeCiphertext(0xB1), CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(2, result.Version);
        Assert.Equivalent(result, await store.GetPreferencesAsync(accountId, CancellationToken.None));
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
            if (result is not null)
            {
                Interlocked.Increment(ref successCount);
            }
        })));

        Assert.Equal(1, successCount);
        Assert.Equal(1, (await store.GetPreferencesAsync(accountId, CancellationToken.None))!.Version);
    }

    /// <summary>sharing_preferences.account_id has an FK to accounts -- the CAS tests need a real row.</summary>
    private async Task<Guid> SeedAccountAsync(string email)
    {
        var accountId = Guid.NewGuid();
        await SeedAccountsWithEmailsAsync([(accountId, email)]);
        return accountId;
    }

    /// <summary>patient_link_invites and patient_links both have FKs to accounts (S11-03 fatia 9) -- every id used as a professional or patient account side needs a real row first. Email is unique per id, not semantic; these tests only care about ids.</summary>
    private async Task SeedAccountsAsync(params Guid[] accountIds) =>
        await SeedAccountsWithEmailsAsync(accountIds.Select(id => (id, $"{id}@example.com")));

    private async Task SeedAccountsWithEmailsAsync(IEnumerable<(Guid Id, string Email)> accounts)
    {
        var accountStore = new Api.Accounts.PostgresAccountStore(_dataSource, new Api.Accounts.TotpSecretCipher(new byte[32]));
        foreach (var (id, email) in accounts)
        {
            await accountStore.InsertAsync(
                new Api.Accounts.Account(id, email, Api.Accounts.AccountRole.Patient, PasswordVerifier: null, GoogleSubjectId: null),
                CancellationToken.None);
        }
    }

    private async Task<PatientLinkStore> LinkedStoreAsync()
    {
        var store = new PatientLinkStore(_dataSource);
        await SeedAccountsAsync(ProfessionalId, PatientAccountId);
        var invite = await store.CreateInviteAsync(ProfessionalId, PatientId, CancellationToken.None);
        await store.RedeemAsync(invite.Code, PatientAccountId, CancellationToken.None);
        return store;
    }

    private static byte[] SomeCiphertext(byte fill = 0x01) => SomeBlob(fill, 28);

    private static byte[] SomeBlob(byte fill, int length)
    {
        var blob = new byte[length];
        Array.Fill(blob, fill);
        return blob;
    }
}
