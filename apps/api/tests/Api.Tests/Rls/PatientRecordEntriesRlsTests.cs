using Api.Data;
using Api.Patients;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Rls;

/// <summary>
/// Proves the tenant_isolation RLS policy and the SELECT/INSERT-only grants on
/// patient_record_entries against a real Postgres instance -- same discipline as
/// HealthCheckProbeRlsTests: every query connects as app_role, never postgres/superuser.
/// </summary>
[Collection("Database")]
public sealed class PatientRecordEntriesRlsTests : IAsyncLifetime
{
    private static readonly Guid ProfessionalA = Guid.NewGuid();
    private static readonly Guid ProfessionalB = Guid.NewGuid();

    private readonly PostgresContainerFixture _fixture;
    private readonly List<NpgsqlDataSource> _createdDataSources = [];
    private Respawner _respawner = null!;

    public PatientRecordEntriesRlsTests(PostgresContainerFixture fixture)
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
    public async Task ProfessionalA_AppendsAndReadsOwnEntries_SeesThem()
    {
        var store = CreateStore();
        var patientId = Guid.NewGuid();
        await store.AppendAsync(
            new PatientRecordEntry(Guid.NewGuid(), ProfessionalA, patientId, 1, [0x01], [0xAA], DateTimeOffset.UtcNow),
            CancellationToken.None);

        var entries = await store.ListAsync(ProfessionalA, patientId, CancellationToken.None);

        var entry = Assert.Single(entries);
        Assert.Equal(1, entry.Sequence);
    }

    [Fact]
    public async Task ProfessionalB_ReadsProfessionalAsPatient_SeesNoRows()
    {
        var store = CreateStore();
        var patientId = Guid.NewGuid();
        await store.AppendAsync(
            new PatientRecordEntry(Guid.NewGuid(), ProfessionalA, patientId, 1, [0x01], [0xAA], DateTimeOffset.UtcNow),
            CancellationToken.None);

        var entries = await store.ListAsync(ProfessionalB, patientId, CancellationToken.None);

        Assert.Empty(entries);
    }

    [Fact]
    public async Task AsAppRole_DirectUpdate_FailsWithPermissionDenied()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE patient_record_entries SET ciphertext = '\\x00' WHERE true";

        var ex = await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
    }

    [Fact]
    public async Task AsAppRole_DirectDelete_FailsWithPermissionDenied()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM patient_record_entries WHERE true";

        var ex = await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
    }

    [Fact]
    public async Task AsAppRole_ForgedInsertUnderAnotherTenant_IsBlockedByRlsWithCheck()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        // Session context claims to be ProfessionalA, but the row being inserted forges
        // ProfessionalB's tenant_id -- the WITH CHECK clause must reject this regardless of
        // what the session context says.
        await using (var setTenantCommand = connection.CreateCommand())
        {
            setTenantCommand.Transaction = transaction;
            setTenantCommand.CommandText = "SELECT set_config('app.tenant_id', @tenantId, true)";
            setTenantCommand.Parameters.AddWithValue("tenantId", ProfessionalA.ToString());
            await setTenantCommand.ExecuteNonQueryAsync();
        }

        await using var insertCommand = connection.CreateCommand();
        insertCommand.Transaction = transaction;
        insertCommand.CommandText = """
            INSERT INTO patient_record_entries (id, tenant_id, patient_id, sequence, wrapped_dek, ciphertext, created_at)
            VALUES (@id, @tenantId, @patientId, 1, @wrappedDek, @ciphertext, now())
            """;
        insertCommand.Parameters.AddWithValue("id", Guid.NewGuid());
        insertCommand.Parameters.AddWithValue("tenantId", ProfessionalB);
        insertCommand.Parameters.AddWithValue("patientId", Guid.NewGuid());
        insertCommand.Parameters.AddWithValue("wrappedDek", new byte[] { 0x01 });
        insertCommand.Parameters.AddWithValue("ciphertext", new byte[] { 0xAA });

        // A WITH CHECK failure is reported by Postgres as insufficient_privilege (42501),
        // the same SQLSTATE as a bare permission error -- "new row violates row-level
        // security policy", not a CHECK constraint violation.
        var ex = await Assert.ThrowsAsync<PostgresException>(() => insertCommand.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
    }

    private PatientRecordStore CreateStore()
    {
        var dataSource = NpgsqlDataSourceFactory.Create(_fixture.AppRoleConnectionString);
        _createdDataSources.Add(dataSource);
        return new PatientRecordStore(dataSource);
    }
}
