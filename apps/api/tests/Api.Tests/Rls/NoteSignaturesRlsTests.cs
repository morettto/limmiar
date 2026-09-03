using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Rls;

/// <summary>
/// Proves the tenant_isolation RLS policy and the SELECT/INSERT-only grants on
/// note_signatures against a real Postgres instance -- same discipline as
/// PatientRecordEntriesRlsTests: every query connects as app_role, never postgres/superuser.
/// </summary>
[Collection("Database")]
public sealed class NoteSignaturesRlsTests : IAsyncLifetime
{
    private static readonly Guid ProfessionalA = Guid.NewGuid();
    private static readonly Guid ProfessionalB = Guid.NewGuid();

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public NoteSignaturesRlsTests(PostgresContainerFixture fixture)
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

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task AsAppRole_DirectUpdate_FailsWithPermissionDenied()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE note_signatures SET signature = '\\x00' WHERE true";

        var ex = await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
    }

    [Fact]
    public async Task AsAppRole_DirectDelete_FailsWithPermissionDenied()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM note_signatures WHERE true";

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
            INSERT INTO note_signatures (tenant_id, note_id, revision, signature)
            VALUES (@tenantId, @noteId, 0, @signature)
            """;
        insertCommand.Parameters.AddWithValue("tenantId", ProfessionalB);
        insertCommand.Parameters.AddWithValue("noteId", Guid.NewGuid());
        insertCommand.Parameters.AddWithValue("signature", new byte[60]);

        // A WITH CHECK failure is reported by Postgres as insufficient_privilege (42501),
        // the same SQLSTATE as a bare permission error -- "new row violates row-level
        // security policy", not a CHECK constraint violation.
        var ex = await Assert.ThrowsAsync<PostgresException>(() => insertCommand.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
    }
}
