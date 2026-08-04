using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Rls;

/// <summary>
/// Proves that the tenant_isolation RLS policy on health_check_probe actually works
/// against a real Postgres instance. Every query in this class connects as app_role
/// (never postgres/superuser) -- connecting as the table owner or a superuser would
/// bypass FORCE ROW LEVEL SECURITY and let these tests "pass" without the policy being
/// exercised at all.
/// </summary>
[Collection("Database")]
public sealed class HealthCheckProbeRlsTests : IAsyncLifetime
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public HealthCheckProbeRlsTests(PostgresContainerFixture fixture)
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

        // Seed directly via the admin (superuser) connection, bypassing RLS entirely,
        // so the test data setup itself does not depend on the policy under test.
        await using var seedCommand = adminConnection.CreateCommand();
        seedCommand.CommandText = """
            INSERT INTO health_check_probe (tenant_id, probe_value) VALUES
                (@tenantA, 'probe-a'),
                (@tenantB, 'probe-b');
            """;
        seedCommand.Parameters.AddWithValue("tenantA", TenantA);
        seedCommand.Parameters.AddWithValue("tenantB", TenantB);
        await seedCommand.ExecuteNonQueryAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Select_WithoutTenantContext_ReturnsNoRows()
    {
        var rows = await SelectProbeValuesAsync(tenantId: null);

        Assert.Empty(rows);
    }

    [Fact]
    public async Task Select_WithMatchingTenantContext_ReturnsOnlyOwnRows()
    {
        var rows = await SelectProbeValuesAsync(TenantA);

        var row = Assert.Single(rows);
        Assert.Equal("probe-a", row);
    }

    [Fact]
    public async Task Select_WithOtherTenantContext_DoesNotSeeOtherTenantsRows()
    {
        var rows = await SelectProbeValuesAsync(TenantB);

        // Assert.Single (not just DoesNotContain("probe-a", rows)) so a policy bug that
        // hides ALL rows -- not just the other tenant's -- would also fail this test.
        var row = Assert.Single(rows);
        Assert.Equal("probe-b", row);
    }

    /// <summary>
    /// Connects as app_role and, when <paramref name="tenantId"/> is provided, sets the
    /// tenant context transactionally via <c>set_config(..., is_local: true)</c> before
    /// running the SELECT -- exactly the pattern the tenant_isolation policy relies on.
    /// </summary>
    private async Task<List<string>> SelectProbeValuesAsync(Guid? tenantId)
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();

        await using var transaction = await connection.BeginTransactionAsync();

        if (tenantId is not null)
        {
            await using var setTenantCommand = connection.CreateCommand();
            setTenantCommand.Transaction = transaction;
            setTenantCommand.CommandText = "SELECT set_config('app.tenant_id', @tenantId, true)";
            setTenantCommand.Parameters.AddWithValue("tenantId", tenantId.Value.ToString());
            await setTenantCommand.ExecuteNonQueryAsync();
        }

        await using var selectCommand = connection.CreateCommand();
        selectCommand.Transaction = transaction;
        selectCommand.CommandText = "SELECT probe_value FROM health_check_probe ORDER BY probe_value";

        var results = new List<string>();
        await using (var reader = await selectCommand.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                results.Add(reader.GetString(0));
            }
        }

        await transaction.CommitAsync();
        return results;
    }
}
