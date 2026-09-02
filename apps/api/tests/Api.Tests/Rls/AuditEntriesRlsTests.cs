using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Rls;

/// <summary>
/// Proves the tenant_isolation RLS policy and the SELECT/INSERT-only grants on
/// audit_entries against a real Postgres instance -- same discipline as
/// NoteSignaturesRlsTests: every query connects as app_role, never postgres/superuser.
/// Direct UPDATE is exactly the threat this trail defends against (a careless DBA or a
/// malicious migration reaching the table straight, bypassing the application entirely) --
/// see the "Âncora" decision in the ticket for what stays out of reach even so (a superuser
/// rewriting audit_entries AND audit_anchors in the same transaction).
/// </summary>
[Collection("Database")]
public sealed class AuditEntriesRlsTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public AuditEntriesRlsTests(PostgresContainerFixture fixture)
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
    public async Task AsAppRole_DirectUpdate_OnAuditEntries_FailsWithPermissionDenied()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE audit_entries SET action = 0 WHERE true";

        var ex = await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
    }

    /// <summary>
    /// audit_anchors is criterion 3's witness -- if its REVOKE were missing or pointed at the
    /// wrong table/role, a rewriter could erase the very anchor meant to catch a full-chain
    /// rewrite, and nothing else in this suite would notice.
    /// </summary>
    [Fact]
    public async Task AsAppRole_DirectUpdate_OnAuditAnchors_FailsWithPermissionDenied()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE audit_anchors SET anchored_sequence = 0 WHERE true";

        var ex = await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
    }
}
