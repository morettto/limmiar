using Api.Audit;
using Api.Data;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Audit;

/// <summary>
/// Proves AuditEntryStore against a real Postgres instance -- the store always connects as
/// app_role, same discipline as NoteSignatureStoreTests. The one exception is the anchor test
/// below, whose tampering step deliberately uses the admin (superuser) connection: app_role
/// has no UPDATE on audit_entries at all, and direct database access is exactly the threat
/// model acceptance criterion 3 is about.
/// </summary>
[Collection("Database")]
public sealed class AuditEntryStoreTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _fixture;
    private readonly List<NpgsqlDataSource> _createdDataSources = [];
    private Respawner _respawner = null!;

    public AuditEntryStoreTests(PostgresContainerFixture fixture)
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
    }

    public async Task DisposeAsync()
    {
        foreach (var dataSource in _createdDataSources)
        {
            await dataSource.DisposeAsync();
        }
    }

    /// <summary>Fatia 5: the second entry's previous_hash must be the first entry's entry_hash,
    /// and the first entry's own previous_hash must be the genesis root -- the two-link
    /// minimum that proves AppendAsync actually reads the head instead of always chaining
    /// from genesis.</summary>
    [Fact]
    public async Task AppendAsync_TwiceForSameTenant_ChainsSecondPreviousHashToFirstEntryHash()
    {
        var store = CreateStore();
        var tenantId = Guid.NewGuid();
        var deviceId = Guid.NewGuid();

        var first = await store.AppendAsync(tenantId, AuditAction.SignIn, deviceId, CancellationToken.None);
        var second = await store.AppendAsync(tenantId, AuditAction.RecordOpened, deviceId, CancellationToken.None);

        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.Equal(1, first!.Sequence);
        Assert.Equal(AuditChain.GenesisHash.ToArray(), first.PreviousHash);
        Assert.Equal(
            AuditChain.ComputeHash(tenantId, 1, AuditAction.SignIn, deviceId, first.RecordedAt, AuditChain.GenesisHash),
            first.EntryHash);
        Assert.Equal(2, second!.Sequence);
        Assert.Equal(first.EntryHash, second.PreviousHash);
        Assert.Equal(
            AuditChain.ComputeHash(tenantId, 2, AuditAction.RecordOpened, deviceId, second.RecordedAt, first.EntryHash),
            second.EntryHash);
    }

    /// <summary>ListAsync returns the chain oldest-first, tenant-scoped by RLS -- a second
    /// tenant's entries never show up here, and there is no WHERE tenant_id in the store to
    /// accidentally get that wrong.</summary>
    [Fact]
    public async Task ListAsync_AfterTwoAppendsForOneTenant_ReturnsBothOldestFirst_AndNoneForAnotherTenant()
    {
        var store = CreateStore();
        var tenantId = Guid.NewGuid();
        var otherTenantId = Guid.NewGuid();
        var deviceId = Guid.NewGuid();
        await store.AppendAsync(tenantId, AuditAction.SignIn, deviceId, CancellationToken.None);
        await store.AppendAsync(tenantId, AuditAction.SignOut, deviceId, CancellationToken.None);

        var entries = await store.ListAsync(tenantId, CancellationToken.None);
        var otherTenantEntries = await store.ListAsync(otherTenantId, CancellationToken.None);

        Assert.Equal([1L, 2L], entries.Select(e => e.Sequence));
        Assert.Empty(otherTenantEntries);
    }

    /// <summary>Fatia 6, critério 2: eight truly concurrent writers for the same tenant --
    /// UNIQUE (tenant_id, previous_hash) lets exactly one insert through per head, every
    /// loser re-reads and retries, and every one of the eight eventually persists (unlike the
    /// slot-conflict molde in SchedulingEndpointsTests, nobody here is expected to lose
    /// outright). The chain that results must still verify intact end to end.</summary>
    [Fact]
    public async Task AppendAsync_WithEightConcurrentCalls_PersistsEightEntriesAndVerifyStaysIntact()
    {
        var store = CreateStore();
        var tenantId = Guid.NewGuid();
        var deviceId = Guid.NewGuid();

        var tasks = Enumerable.Range(0, 8)
            .Select(_ => Task.Run(() => store.AppendAsync(tenantId, AuditAction.SignIn, deviceId, CancellationToken.None)))
            .ToArray();
        var results = await Task.WhenAll(tasks);

        Assert.All(results, r => Assert.NotNull(r));
        Assert.Equal(Enumerable.Range(1, 8).Select(i => (long)i), results.Select(r => r!.Sequence).OrderBy(s => s));

        var chain = await store.ListAsync(tenantId, CancellationToken.None);
        var verification = AuditChain.Verify(chain, []);
        Assert.True(verification.Intact);
    }

    /// <summary>Branch-coverage par for the "ran out of attempts" path: a competing,
    /// deliberately uncommitted insert holds the genesis slot open so the maxAttempts:1
    /// store's own insert blocks on it and then fails once the competitor commits -- with no
    /// retry budget left, AppendAsync must return null instead of throwing or looping
    /// forever.</summary>
    [Fact]
    public async Task AppendAsync_WhenMaxAttemptsIsOne_LosesTheRaceAndReturnsNull()
    {
        var tenantId = Guid.NewGuid();
        var deviceId = Guid.NewGuid();
        var blockerDataSource = CreateDataSource();

        await using var blockerScope = await blockerDataSource.OpenTenantScopedTransactionAsync(tenantId, CancellationToken.None);
        await using (var insertCommand = blockerScope.Connection.CreateCommand())
        {
            insertCommand.Transaction = blockerScope.Transaction;
            insertCommand.CommandText = """
                INSERT INTO audit_entries (tenant_id, sequence, action, device_id, recorded_at, previous_hash, entry_hash)
                VALUES (@tenantId, 1, 0, @deviceId, @recordedAt, @previousHash, @entryHash)
                """;
            insertCommand.Parameters.AddWithValue("tenantId", tenantId);
            insertCommand.Parameters.AddWithValue("deviceId", deviceId);
            insertCommand.Parameters.AddWithValue("recordedAt", DateTimeOffset.UtcNow);
            insertCommand.Parameters.AddWithValue("previousHash", AuditChain.GenesisHash.ToArray());
            insertCommand.Parameters.AddWithValue("entryHash", Enumerable.Repeat((byte)0xEE, 32).ToArray());
            await insertCommand.ExecuteNonQueryAsync();
        }

        var store = new AuditEntryStore(CreateDataSource(), maxAttempts: 1);
        var appendTask = Task.Run(() => store.AppendAsync(tenantId, AuditAction.SignIn, deviceId, CancellationToken.None));

        await WaitUntilBlockedOnAuditEntriesInsertAsync();
        await blockerScope.Transaction.CommitAsync();
        var result = await appendTask;

        Assert.Null(result);
    }

    /// <summary>Fatia 7, critério 3: the anchor is what survives a rewrite that leaves no
    /// internal break behind. Three entries are appended, the chain head is anchored, and then
    /// the superuser rewrites every row and recomputes every hash so the chain still walks
    /// intact from genesis -- Verify with no anchors reports Ok, which is precisely why the
    /// witness has to exist. Verify with the anchors read back reports AnchorMismatch at the
    /// anchored sequence.</summary>
    [Fact]
    public async Task Verify_AfterAdminRewritesTheWholeChainWithRecomputedHashes_ReportsAnchorMismatch()
    {
        var store = CreateStore();
        var tenantId = Guid.NewGuid();
        var deviceId = Guid.NewGuid();
        await store.AppendAsync(tenantId, AuditAction.SignIn, deviceId, CancellationToken.None);
        await store.AppendAsync(tenantId, AuditAction.RecordOpened, deviceId, CancellationToken.None);
        await store.AppendAsync(tenantId, AuditAction.NoteSigned, deviceId, CancellationToken.None);
        var chainBeforeRewrite = await store.ListAsync(tenantId, CancellationToken.None);

        var anchor = await store.CaptureAnchorAsync(tenantId, CancellationToken.None);
        await RewriteWholeChainAsAdminAsync(chainBeforeRewrite, AuditAction.ExportRequested);

        Assert.NotNull(anchor);
        Assert.Equal(3, anchor!.AnchoredSequence);
        Assert.Equal(chainBeforeRewrite[2].EntryHash, anchor.AnchoredHash);

        var rewrittenChain = await store.ListAsync(tenantId, CancellationToken.None);
        Assert.True(AuditChain.Verify(rewrittenChain, []).Intact);

        var anchors = await store.ListAnchorsAsync(tenantId, CancellationToken.None);
        var verification = AuditChain.Verify(rewrittenChain, anchors);

        Assert.False(verification.Intact);
        Assert.Equal(3, verification.FirstBrokenSequence);
        Assert.Equal(AuditBreakKind.AnchorMismatch, verification.BreakKind);
        var storedAnchor = anchors.Single();
        Assert.Equal(tenantId, storedAnchor.TenantId);
        // timestamptz keeps microseconds, DateTimeOffset keeps 100ns ticks -- the round trip
        // can only lose sub-microsecond precision, never pick a different instant.
        Assert.Equal(anchor.AnchoredAt, storedAnchor.AnchoredAt, TimeSpan.FromMilliseconds(1));
    }

    /// <summary>Nothing to witness yet: a tenant with no entries has no chain head, so there is
    /// no anchor to capture and none is written.</summary>
    [Fact]
    public async Task CaptureAnchorAsync_ForATenantWithNoEntries_ReturnsNull()
    {
        var store = CreateStore();
        var tenantId = Guid.NewGuid();

        var anchor = await store.CaptureAnchorAsync(tenantId, CancellationToken.None);

        Assert.Null(anchor);
        Assert.Empty(await store.ListAnchorsAsync(tenantId, CancellationToken.None));
    }

    /// <summary>Rewrites every row of the chain through the admin (superuser) connection,
    /// recomputing each entry_hash so the result is internally coherent end to end -- the
    /// "reescrita completa e recomputada" of the ticket's Âncora decision. Superuser is what
    /// makes this possible at all: app_role has no UPDATE grant, and even the table owner is
    /// held by FORCE ROW LEVEL SECURITY. No set_config('app.tenant_id') here for the same
    /// reason -- a superuser bypasses the tenant_isolation policy outright.</summary>
    private async Task RewriteWholeChainAsAdminAsync(IReadOnlyList<AuditEntry> chain, AuditAction rewrittenAction)
    {
        await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await adminConnection.OpenAsync();

        var previousHash = AuditChain.GenesisHash.ToArray();
        foreach (var entry in chain)
        {
            var entryHash = AuditChain.ComputeHash(
                entry.TenantId, entry.Sequence, rewrittenAction, entry.DeviceId, entry.RecordedAt, previousHash);

            await using var updateCommand = adminConnection.CreateCommand();
            updateCommand.CommandText = """
                UPDATE audit_entries
                SET action = @action, previous_hash = @previousHash, entry_hash = @entryHash
                WHERE tenant_id = @tenantId AND sequence = @sequence
                """;
            updateCommand.Parameters.AddWithValue("action", (short)rewrittenAction);
            updateCommand.Parameters.AddWithValue("previousHash", previousHash);
            updateCommand.Parameters.AddWithValue("entryHash", entryHash);
            updateCommand.Parameters.AddWithValue("tenantId", entry.TenantId);
            updateCommand.Parameters.AddWithValue("sequence", entry.Sequence);
            await updateCommand.ExecuteNonQueryAsync();

            previousHash = entryHash;
        }
    }

    /// <summary>Polls pg_stat_activity instead of sleeping a guessed duration -- deterministic
    /// proof that the maxAttempts:1 call's own INSERT is genuinely blocked on the still-open
    /// competing transaction before that transaction is released.</summary>
    private async Task WaitUntilBlockedOnAuditEntriesInsertAsync()
    {
        await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await adminConnection.OpenAsync();

        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            await using var command = adminConnection.CreateCommand();
            command.CommandText = """
                SELECT COUNT(*) FROM pg_stat_activity
                WHERE wait_event_type = 'Lock' AND query ILIKE '%INSERT INTO audit_entries%'
                """;
            var blockedCount = (long)(await command.ExecuteScalarAsync())!;
            if (blockedCount > 0)
            {
                return;
            }

            await Task.Delay(20);
        }

        throw new TimeoutException("Timed out waiting for the maxAttempts:1 insert to block on the held row.");
    }

    private AuditEntryStore CreateStore() => new(CreateDataSource());

    private NpgsqlDataSource CreateDataSource()
    {
        var dataSource = NpgsqlDataSourceFactory.Create(_fixture.AppRoleConnectionString);
        _createdDataSources.Add(dataSource);
        return dataSource;
    }
}
