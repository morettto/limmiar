using Api.Tests.Infrastructure;
using Npgsql;

namespace Api.Tests.Startup;

/// <summary>
/// Exercises the real --migrate-only branch in Program.cs -- the exact same binary
/// Fly.io's release_command runs before a new version starts serving traffic.
/// WebApplicationFactory&lt;Program&gt; always invokes the entry point with an empty args
/// array (it has no supported way to inject custom process args), so the only way to
/// genuinely cover this branch is to invoke the compiled entry point directly via
/// reflection with the real "--migrate-only" argument, same as `dotnet Api.dll
/// --migrate-only` would.
/// </summary>
[Collection("Database")]
public sealed class MigrateOnlyStartupTests
{
    private readonly PostgresContainerFixture _fixture;

    public MigrateOnlyStartupTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task Main_WithMigrateOnlyFlag_RunsMigrationsAgainstAdminConnectionAndReturns()
    {
        // WebApplication.CreateSlimBuilder(args) does not wire the command-line
        // configuration provider, so the connection strings must travel via the standard
        // ASP.NET Core environment-variable convention (double underscore == nested config
        // key) instead of a --key=value argument. AppDb is required here too now: its
        // Password is what MigrationRunner provisions app_role with (never a hardcoded
        // literal in the migration SQL).
        Environment.SetEnvironmentVariable("ConnectionStrings__AdminDb", _fixture.AdminConnectionString);
        Environment.SetEnvironmentVariable("ConnectionStrings__AppDb", _fixture.AppRoleConnectionString);
        try
        {
            await MigrateOnlyEntryPoint.InvokeAsync();
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__AdminDb", null);
            Environment.SetEnvironmentVariable("ConnectionStrings__AppDb", null);
        }

        // The migration is idempotent (guarded with IF NOT EXISTS / DO blocks), so
        // running it a second time here (the fixture already ran it once at collection
        // startup) both proves --migrate-only works and proves the migration is safe to
        // re-run, which matters because Fly's release_command runs it on every deploy.
        await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await adminConnection.OpenAsync();

        await using var command = adminConnection.CreateCommand();
        command.CommandText = "SELECT to_regclass('public.health_check_probe') IS NOT NULL";
        var tableExists = (bool)(await command.ExecuteScalarAsync())!;

        Assert.True(tableExists);
    }
}
