using Api.Tests.Infrastructure;
using Npgsql;

namespace Api.Tests.Migrations;

/// <summary>
/// Regression coverage for S08-29: 0005_create_note_signatures.sql was edited in place after
/// publication (S08-15, commit 2262717) to rename `revisao` to `revision`. Because
/// MigrationRunner has no applied-migrations table and reruns every *.sql file on every boot
/// (see MigrationRunner's own doc comment), that edit is invisible to a database where the
/// original 0005 already ran -- CREATE TABLE IF NOT EXISTS is a no-op there, the column stays
/// `revisao`, and NoteSignatureStore (which speaks `revision`) fails with 42703
/// undefined_column. 0008_rename_note_signatures_revisao_to_revision.sql is the fix.
///
/// Runs against a scratch database created inside the shared Testcontainers Postgres instance
/// (same connection-string-derivation pattern PostgresContainerFixture.AppRoleConnectionString
/// already uses) rather than a container of its own -- roles are cluster-wide, so app_role
/// (created by 0002 against the fixture's own database) already exists here too. Migration SQL
/// is read straight off disk at AppContext.BaseDirectory/migrations, the same files
/// MigrationRunner and PostgresContainerFixture resolve, copied there by Directory.Build.props
/// for every project including this test project -- no embedded literal of 0005's text. What
/// protects against 0005 being edited in place again is the first assert in
/// Migration0008_OnBaseWithPublished0005_RenamesColumnAndConstraint below: if 0005 on disk ever
/// stops creating `revisao`, that assert is the one that fails, not a frozen copy going stale.
/// </summary>
[Collection("Database")]
public sealed class NoteSignaturesRevisionRenameTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _fixture;
    private readonly string _scratchDatabaseName = $"limmiar_s08_29_{Guid.NewGuid():N}";
    private string _scratchConnectionString = null!;

    public NoteSignaturesRevisionRenameTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    public async Task InitializeAsync()
    {
        var quotedName = new NpgsqlCommandBuilder().QuoteIdentifier(_scratchDatabaseName);

        try
        {
            await using (var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString))
            {
                await adminConnection.OpenAsync();
                await using var createDatabaseCommand = adminConnection.CreateCommand();
                createDatabaseCommand.CommandText = $"CREATE DATABASE {quotedName}";
                await createDatabaseCommand.ExecuteNonQueryAsync();
            }

            _scratchConnectionString = new NpgsqlConnectionStringBuilder(_fixture.AdminConnectionString)
            {
                Database = _scratchDatabaseName,
            }.ConnectionString;

            // Seeds the scratch database with 0005 exactly as it reads on disk today. After this
            // ticket's revert, disk matches the published S08-15 shape (column `revisao`) again.
            await ApplyMigrationAsync("0005_create_note_signatures.sql");
        }
        catch
        {
            // xUnit v2 does not run DisposeAsync when InitializeAsync throws. Without this,
            // a failure after CREATE DATABASE (e.g. 0005 failing to apply) would leak
            // `_scratchDatabaseName` in the shared container until the whole suite ends.
            await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
            await adminConnection.OpenAsync();
            await using var dropDatabaseCommand = adminConnection.CreateCommand();
            dropDatabaseCommand.CommandText = $"DROP DATABASE IF EXISTS {quotedName} WITH (FORCE)";
            await dropDatabaseCommand.ExecuteNonQueryAsync();
            throw;
        }
    }

    public async Task DisposeAsync()
    {
        // Npgsql pools physical connections per connection string; DROP DATABASE refuses while
        // any of them are still open, even after every `await using` above has returned its
        // connection to the pool. ClearPool forces the pooled connections closed first.
        using var probe = new NpgsqlConnection(_scratchConnectionString);
        NpgsqlConnection.ClearPool(probe);

        await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await adminConnection.OpenAsync();
        await using var dropDatabaseCommand = adminConnection.CreateCommand();
        dropDatabaseCommand.CommandText =
            $"DROP DATABASE IF EXISTS {new NpgsqlCommandBuilder().QuoteIdentifier(_scratchDatabaseName)} WITH (FORCE)";
        await dropDatabaseCommand.ExecuteNonQueryAsync();
    }

    [Fact]
    public async Task Migration0008_OnBaseWithPublished0005_RenamesColumnAndConstraint()
    {
        Assert.Equal("revisao", await ColumnNameAsync("revisao"));
        Assert.Null(await ColumnNameAsync("revision"));
        Assert.True(await ConstraintExistsAsync("revisao_not_negative"));
        Assert.False(await ConstraintExistsAsync("revision_not_negative"));

        await ApplyMigrationAsync("0008_rename_note_signatures_revisao_to_revision.sql");

        Assert.Null(await ColumnNameAsync("revisao"));
        Assert.Equal("revision", await ColumnNameAsync("revision"));
        Assert.False(await ConstraintExistsAsync("revisao_not_negative"));
        Assert.True(await ConstraintExistsAsync("revision_not_negative"));
    }

    [Fact]
    public async Task Migration0008_AppliedTwice_LeavesRevisionUnchanged()
    {
        await ApplyMigrationAsync("0008_rename_note_signatures_revisao_to_revision.sql");
        await ApplyMigrationAsync("0008_rename_note_signatures_revisao_to_revision.sql");

        Assert.Null(await ColumnNameAsync("revisao"));
        Assert.Equal("revision", await ColumnNameAsync("revision"));
        Assert.False(await ConstraintExistsAsync("revisao_not_negative"));
        Assert.True(await ConstraintExistsAsync("revision_not_negative"));
    }

    [Fact]
    public async Task Migration0008_OnBaseWithoutNoteSignaturesTable_IsNoOp()
    {
        // Own scratch database, deliberately never seeded with 0005 -- note_signatures does
        // not exist here. Reuses PostgresContainerFixture.AdminConnectionString rather than
        // _scratchConnectionString/_fixture's shared table so this test cannot depend on
        // Initialize/DisposeAsync's 0005 seed lifecycle.
        var databaseName = $"limmiar_s08_29_noop_{Guid.NewGuid():N}";
        var quotedName = new NpgsqlCommandBuilder().QuoteIdentifier(databaseName);

        await using (var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString))
        {
            await adminConnection.OpenAsync();
            await using var createDatabaseCommand = adminConnection.CreateCommand();
            createDatabaseCommand.CommandText = $"CREATE DATABASE {quotedName}";
            await createDatabaseCommand.ExecuteNonQueryAsync();
        }

        var connectionString = new NpgsqlConnectionStringBuilder(_fixture.AdminConnectionString)
        {
            Database = databaseName,
        }.ConnectionString;

        try
        {
            // note_signatures does not exist here. 0008 must be a pure no-op, not the
            // relation-does-not-exist error 'note_signatures'::regclass throws.
            var exception = await Record.ExceptionAsync(
                () => ApplyMigrationAsync("0008_rename_note_signatures_revisao_to_revision.sql", connectionString));

            Assert.Null(exception);
        }
        finally
        {
            using var probe = new NpgsqlConnection(connectionString);
            NpgsqlConnection.ClearPool(probe);

            await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
            await adminConnection.OpenAsync();
            await using var dropDatabaseCommand = adminConnection.CreateCommand();
            dropDatabaseCommand.CommandText = $"DROP DATABASE IF EXISTS {quotedName} WITH (FORCE)";
            await dropDatabaseCommand.ExecuteNonQueryAsync();
        }
    }

    private async Task ApplyMigrationAsync(string fileName, string? connectionString = null)
    {
        var migrationsDirectory = Path.Combine(AppContext.BaseDirectory, "migrations");
        var sql = await File.ReadAllTextAsync(Path.Combine(migrationsDirectory, fileName));

        await using var connection = new NpgsqlConnection(connectionString ?? _scratchConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private async Task<string?> ColumnNameAsync(string candidate)
    {
        await using var connection = new NpgsqlConnection(_scratchConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'note_signatures' AND column_name = @candidate
            """;
        command.Parameters.AddWithValue("candidate", candidate);
        return (string?)await command.ExecuteScalarAsync();
    }

    private async Task<bool> ConstraintExistsAsync(string name)
    {
        await using var connection = new NpgsqlConnection(_scratchConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT 1 FROM pg_constraint
            WHERE conname = @name AND conrelid = to_regclass('note_signatures')
            """;
        command.Parameters.AddWithValue("name", name);
        return await command.ExecuteScalarAsync() is not null;
    }
}
