using Api.Consent;
using Api.Data;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Consent;

/// <summary>
/// Proves ConsentEventStore's contract against a real Postgres instance -- always connects as
/// app_role, same discipline as NoteSignatureStoreTests.
/// </summary>
[Collection("Database")]
public sealed class ConsentEventStoreTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _fixture;
    private readonly List<NpgsqlDataSource> _createdDataSources = [];
    private Respawner _respawner = null!;

    public ConsentEventStoreTests(PostgresContainerFixture fixture)
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

    /// <summary>Fatia 2, decisão 2 do ticket: revogar é um INSERT, nunca um UPDATE -- a linha
    /// Concedido anterior continua legível em ListAsync (mais antigo primeiro) mesmo depois de
    /// uma revogação, e é sobre essa lista que ConsentState.Fold (fatia 1) decide o estado
    /// atual.</summary>
    [Fact]
    public async Task InsertAsync_ForARevocation_LeavesTheEarlierGrantReadable()
    {
        var store = CreateStore();
        var tenantId = Guid.NewGuid();
        var patientId = Guid.NewGuid();

        var grant = await store.InsertAsync(
            new ConsentEvent(tenantId, patientId, ConsentPurpose.Gravacao, ConsentDecision.Concedido, default),
            CancellationToken.None);
        var revocation = await store.InsertAsync(
            new ConsentEvent(tenantId, patientId, ConsentPurpose.Gravacao, ConsentDecision.Revogado, default),
            CancellationToken.None);

        var events = await store.ListAsync(tenantId, patientId, CancellationToken.None);

        Assert.Equal(2, events.Count);
        Assert.Equal(ConsentDecision.Concedido, events[0].Decision);
        Assert.Equal(ConsentDecision.Revogado, events[1].Decision);
        Assert.Equal(grant.RecordedAt, events[0].RecordedAt);
        Assert.Equal(revocation.RecordedAt, events[1].RecordedAt);
        Assert.True(events[0].RecordedAt <= events[1].RecordedAt);
        Assert.Equal(ConsentStatus.Revogado, ConsentState.Fold(events, ConsentPurpose.Gravacao));
    }

    private ConsentEventStore CreateStore()
    {
        var dataSource = NpgsqlDataSourceFactory.Create(_fixture.AppRoleConnectionString);
        _createdDataSources.Add(dataSource);
        return new ConsentEventStore(dataSource);
    }
}
