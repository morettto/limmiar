using Api.Audit;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Audit;

/// <summary>
/// Acceptance criterion 4 ("nenhum campo de conteúdo clínico") proved against the real
/// database, not by regexing the migration file -- a migration added later that never runs
/// against this schema would slip past a text scan but cannot slip past
/// <c>information_schema.columns</c>. Same discipline as
/// SchedulingEndpointsTests.ScheduledSessions_HasNoPlaintextPatientColumn.
/// </summary>
[Collection("Database")]
public sealed class AuditTrailSchemaTests : IAsyncLifetime
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid DeviceId = Guid.NewGuid();
    private static readonly DateTimeOffset RecordedAt = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public AuditTrailSchemaTests(PostgresContainerFixture fixture)
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
    public async Task AuditEntries_HasExactlyTheSevenMetadataColumns()
    {
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'audit_entries'
            ORDER BY column_name
            """;

        var columns = new List<(string Name, string DataType)>();
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                columns.Add((reader.GetString(0), reader.GetString(1)));
            }
        }

        Assert.Equal(
            [
                ("action", "smallint"),
                ("device_id", "uuid"),
                ("entry_hash", "bytea"),
                ("previous_hash", "bytea"),
                ("recorded_at", "timestamp with time zone"),
                ("sequence", "bigint"),
                ("tenant_id", "uuid"),
            ],
            columns);
    }

    [Fact]
    public async Task AuditAnchors_HasExactlyTheFourColumns()
    {
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'audit_anchors'
            ORDER BY column_name
            """;

        var columns = new List<(string Name, string DataType)>();
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                columns.Add((reader.GetString(0), reader.GetString(1)));
            }
        }

        Assert.Equal(
            [
                ("anchored_at", "timestamp with time zone"),
                ("anchored_hash", "bytea"),
                ("anchored_sequence", "bigint"),
                ("tenant_id", "uuid"),
            ],
            columns);
    }

    /// <summary>Every <see cref="AuditAction"/> ordinal inserts cleanly; the ordinal one past
    /// the last defined member is rejected by the audit_action_range CHECK -- the test that
    /// keeps the enum and the DDL's closed range from silently drifting apart.</summary>
    [Fact]
    public async Task AuditActionRangeMatchesEnum()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();

        await using (var setTenantCommand = connection.CreateCommand())
        {
            setTenantCommand.CommandText = "SELECT set_config('app.tenant_id', @tenantId, false)";
            setTenantCommand.Parameters.AddWithValue("tenantId", TenantId.ToString());
            await setTenantCommand.ExecuteNonQueryAsync();
        }

        var definedActions = Enum.GetValues<AuditAction>();
        long sequence = 1;
        foreach (var action in definedActions)
        {
            await InsertEntryAsync(connection, sequence, (short)action);
            sequence++;
        }

        var outOfRangeAction = (short)definedActions.Length;
        var ex = await Assert.ThrowsAsync<PostgresException>(() => InsertEntryAsync(connection, sequence, outOfRangeAction));
        Assert.Equal(PostgresErrorCodes.CheckViolation, ex.SqlState);
    }

    private async Task InsertEntryAsync(NpgsqlConnection connection, long sequence, short action)
    {
        await using var insertCommand = connection.CreateCommand();
        insertCommand.CommandText = """
            INSERT INTO audit_entries (tenant_id, sequence, action, device_id, recorded_at, previous_hash, entry_hash)
            VALUES (@tenantId, @sequence, @action, @deviceId, @recordedAt, @previousHash, @entryHash)
            """;
        insertCommand.Parameters.AddWithValue("tenantId", TenantId);
        insertCommand.Parameters.AddWithValue("sequence", sequence);
        insertCommand.Parameters.AddWithValue("action", action);
        insertCommand.Parameters.AddWithValue("deviceId", DeviceId);
        insertCommand.Parameters.AddWithValue("recordedAt", RecordedAt);
        insertCommand.Parameters.AddWithValue("previousHash", SeedHash((byte)sequence));
        insertCommand.Parameters.AddWithValue("entryHash", SeedHash((byte)(sequence + 100)));
        await insertCommand.ExecuteNonQueryAsync();
    }

    private static byte[] SeedHash(byte seed) => Enumerable.Repeat(seed, 32).ToArray();
}
