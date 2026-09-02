using Api.Consent;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Consent;

/// <summary>
/// Proves the two closed-range CHECK constraints on <c>consent_events</c> against a real
/// Postgres instance -- molde de <c>Api.Tests.Audit.AuditEntriesSchemaTests.AuditActionRangeMatchesEnum</c>.
/// A migration edited later that lets the DDL's numeric range drift away from the enum would
/// slip past a text scan of the .sql file but cannot slip past a real insert.
/// </summary>
[Collection("Database")]
public sealed class ConsentEventsSchemaTests : IAsyncLifetime
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public ConsentEventsSchemaTests(PostgresContainerFixture fixture)
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

    /// <summary>Every <see cref="ConsentPurpose"/> ordinal inserts cleanly; the ordinal one past
    /// the last defined member is rejected by the consent_purpose_range CHECK.</summary>
    [Fact]
    public async Task ConsentPurposeRangeMatchesEnum()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();
        await SetTenantAsync(connection);

        var definedPurposes = Enum.GetValues<ConsentPurpose>();
        foreach (var purpose in definedPurposes)
        {
            await InsertEventAsync(connection, Guid.NewGuid(), (short)purpose, (short)ConsentDecision.Concedido);
        }

        var outOfRangePurpose = (short)definedPurposes.Length;
        var ex = await Assert.ThrowsAsync<PostgresException>(
            () => InsertEventAsync(connection, Guid.NewGuid(), outOfRangePurpose, (short)ConsentDecision.Concedido));
        Assert.Equal(PostgresErrorCodes.CheckViolation, ex.SqlState);
    }

    /// <summary>Equivalent proof for <see cref="ConsentDecision"/> and the
    /// consent_decision_range CHECK.</summary>
    [Fact]
    public async Task ConsentDecisionRangeMatchesEnum()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();
        await SetTenantAsync(connection);

        var definedDecisions = Enum.GetValues<ConsentDecision>();
        foreach (var decision in definedDecisions)
        {
            await InsertEventAsync(connection, Guid.NewGuid(), (short)ConsentPurpose.Gravacao, (short)decision);
        }

        var outOfRangeDecision = (short)definedDecisions.Length;
        var ex = await Assert.ThrowsAsync<PostgresException>(
            () => InsertEventAsync(connection, Guid.NewGuid(), (short)ConsentPurpose.Gravacao, outOfRangeDecision));
        Assert.Equal(PostgresErrorCodes.CheckViolation, ex.SqlState);
    }

    private static async Task SetTenantAsync(NpgsqlConnection connection)
    {
        await using var setTenantCommand = connection.CreateCommand();
        setTenantCommand.CommandText = "SELECT set_config('app.tenant_id', @tenantId, false)";
        setTenantCommand.Parameters.AddWithValue("tenantId", TenantId.ToString());
        await setTenantCommand.ExecuteNonQueryAsync();
    }

    private async Task InsertEventAsync(NpgsqlConnection connection, Guid patientId, short purpose, short decision)
    {
        await using var insertCommand = connection.CreateCommand();
        insertCommand.CommandText = """
            INSERT INTO consent_events (tenant_id, patient_id, purpose, decision)
            VALUES (@tenantId, @patientId, @purpose, @decision)
            """;
        insertCommand.Parameters.AddWithValue("tenantId", TenantId);
        insertCommand.Parameters.AddWithValue("patientId", patientId);
        insertCommand.Parameters.AddWithValue("purpose", purpose);
        insertCommand.Parameters.AddWithValue("decision", decision);
        await insertCommand.ExecuteNonQueryAsync();
    }
}
