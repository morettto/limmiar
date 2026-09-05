using Api.Data;
using Api.Notes;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Notes;

/// <summary>
/// Proves NoteSignatureStore's contract against a real Postgres instance -- always connects
/// as app_role, same discipline as PatientRecordEntriesRlsTests.
/// </summary>
[Collection("Database")]
public sealed class NoteSignatureStoreTests : IAsyncLifetime
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();

    private readonly PostgresContainerFixture _fixture;
    private readonly List<NpgsqlDataSource> _createdDataSources = [];
    private Respawner _respawner = null!;

    public NoteSignatureStoreTests(PostgresContainerFixture fixture)
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

    [Fact]
    public async Task InsertAsync_FirstSignatureForNote_ReturnsRowWithServerSignedAt()
    {
        var store = CreateStore();
        var noteId = Guid.NewGuid();
        var requestedSignedAt = DateTimeOffset.UnixEpoch;
        var entry = new NoteSignature(TenantA, noteId, 3, new byte[60], requestedSignedAt);

        var inserted = await store.InsertAsync(entry, CancellationToken.None);

        Assert.NotNull(inserted);
        Assert.Equal(TenantA, inserted!.TenantId);
        Assert.Equal(noteId, inserted.NoteId);
        Assert.Equal(3, inserted.Revision);
        // The store's INSERT does not bind the caller's SignedAt -- the column default `now()`
        // decides it, so a request that (accidentally or maliciously) supplied a fixed instant
        // never controls the persisted audit timestamp.
        Assert.NotEqual(requestedSignedAt, inserted.SignedAt);
    }

    [Fact]
    public async Task InsertAsync_SecondSignatureForSameNote_ReturnsNull()
    {
        var store = CreateStore();
        var noteId = Guid.NewGuid();
        await store.InsertAsync(new NoteSignature(TenantA, noteId, 1, new byte[60], DateTimeOffset.UtcNow), CancellationToken.None);

        var second = await store.InsertAsync(new NoteSignature(TenantA, noteId, 1, new byte[60], DateTimeOffset.UtcNow), CancellationToken.None);

        Assert.Null(second);
    }

    [Fact]
    public async Task FindAsync_UnderAnotherTenant_ReturnsNull()
    {
        var store = CreateStore();
        var noteId = Guid.NewGuid();
        await store.InsertAsync(new NoteSignature(TenantA, noteId, 1, new byte[60], DateTimeOffset.UtcNow), CancellationToken.None);

        var found = await store.FindAsync(TenantB, noteId, CancellationToken.None);

        Assert.Null(found);
    }

    private NoteSignatureStore CreateStore()
    {
        var dataSource = NpgsqlDataSourceFactory.Create(_fixture.AppRoleConnectionString);
        _createdDataSources.Add(dataSource);
        return new NoteSignatureStore(dataSource);
    }
}
