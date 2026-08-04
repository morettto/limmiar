using Npgsql;

namespace Api.Data;

/// <summary>
/// Minimal, reflection-free SQL migration runner. Executes every *.sql file found in
/// <paramref name="migrationsDirectory"/>, in ordinal filename order, against the given
/// admin/superuser data source. Not a general-purpose migration framework (no applied-
/// migrations tracking table) -- deliberately small so it stays AOT-safe without
/// depending on DbUp/FluentMigrator/EF Migrations, none of which have documented Native
/// AOT compatibility.
/// </summary>
public static class MigrationRunner
{
    /// <summary>
    /// Placeholder substituted into migration SQL with <paramref name="appRolePassword"/>
    /// before execution. Not a bound query parameter: DDL (CREATE ROLE ... PASSWORD) does
    /// not support parameter binding, and the value never comes from untrusted/attacker
    /// input -- it is the same secret already configured for the app's own database
    /// connection (see NpgsqlDataSourceFactory / Program.cs), never a literal checked into
    /// source control.
    /// </summary>
    private const string AppRolePasswordPlaceholder = "{{APP_ROLE_PASSWORD}}";

    public static async Task RunAsync(
        NpgsqlDataSource adminDataSource,
        string migrationsDirectory,
        string appRolePassword,
        CancellationToken cancellationToken = default)
    {
        var migrationFiles = Directory
            .GetFiles(migrationsDirectory, "*.sql")
            .OrderBy(path => path, StringComparer.Ordinal);

        await using var connection = await adminDataSource.OpenConnectionAsync(cancellationToken);

        // Escaped defensively even though this is a trusted secret, not attacker input --
        // a literal single quote in the password would otherwise break the substituted SQL.
        var escapedPassword = appRolePassword.Replace("'", "''");

        foreach (var migrationFile in migrationFiles)
        {
            var sql = await File.ReadAllTextAsync(migrationFile, cancellationToken);
            sql = sql.Replace(AppRolePasswordPlaceholder, escapedPassword);

            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }
}
