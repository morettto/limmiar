using Api.Consent;
using Api.Data;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Rls;

/// <summary>
/// Proves the tenant_isolation RLS policy and the SELECT/INSERT-only grants on
/// consent_events against a real Postgres instance -- same discipline as
/// NoteSignaturesRlsTests: every query connects as app_role, never postgres/superuser.
/// </summary>
[Collection("Database")]
public sealed class ConsentEventsRlsTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _fixture;
    private readonly List<NpgsqlDataSource> _createdDataSources = [];
    private Respawner _respawner = null!;

    public ConsentEventsRlsTests(PostgresContainerFixture fixture)
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

    /// <summary>ListAsync has no WHERE tenant_id clause of its own -- this proves the RLS
    /// policy alone keeps tenant B's read from seeing tenant A's consent events for the same
    /// patient id.</summary>
    [Fact]
    public async Task ConsentEvents_AreInvisibleToAnotherTenant()
    {
        var store = CreateStore();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var patientId = Guid.NewGuid();
        await store.InsertAsync(
            new ConsentEvent(tenantA, patientId, ConsentPurpose.Gravacao, ConsentDecision.Concedido, default),
            CancellationToken.None);

        var eventsForTenantB = await store.ListAsync(tenantB, patientId, CancellationToken.None);

        Assert.Empty(eventsForTenantB);
    }

    /// <summary>consent_events is append-only for app_role -- the running API never gets a
    /// direct write path to UPDATE or DELETE a past decision, which is what makes "a revogação
    /// não afeta ação passada" structural instead of an application rule.</summary>
    [Fact]
    public async Task RejectUpdateAndDeleteForAppRole()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();

        await using (var updateCommand = connection.CreateCommand())
        {
            updateCommand.CommandText = "UPDATE consent_events SET decision = 0 WHERE true";
            var ex = await Assert.ThrowsAsync<PostgresException>(() => updateCommand.ExecuteNonQueryAsync());
            Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
        }

        await using (var deleteCommand = connection.CreateCommand())
        {
            deleteCommand.CommandText = "DELETE FROM consent_events WHERE true";
            var ex = await Assert.ThrowsAsync<PostgresException>(() => deleteCommand.ExecuteNonQueryAsync());
            Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
        }
    }

    private ConsentEventStore CreateStore()
    {
        var dataSource = NpgsqlDataSourceFactory.Create(_fixture.AppRoleConnectionString);
        _createdDataSources.Add(dataSource);
        return new ConsentEventStore(dataSource);
    }
}
