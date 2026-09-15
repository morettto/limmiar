using Api.Data;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Api.Tests.Infrastructure;

/// <summary>
/// Boots a single real Postgres container (Testcontainers) shared by every test in the
/// "Database" collection, runs the real migrations against it via the admin connection,
/// and exposes both an admin (superuser) and an app_role connection string. Tests must
/// always connect as app_role when exercising RLS -- connecting as the superuser would
/// bypass FORCE ROW LEVEL SECURITY and make the RLS tests pass regardless of whether the
/// policy actually works.
/// </summary>
public sealed class PostgresContainerFixture : IAsyncLifetime
{
    /// <summary>Substituted into migrations/0001_create_health_check_probe.sql's
    /// {{APP_ROLE_PASSWORD}} placeholder by MigrationRunner -- the file itself has no
    /// literal password to match.</summary>
    public const string AppRolePassword = "app_role_dev_password";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("limmiar_test")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .Build();

    // MaxPoolSize caps each connection string's own pool (Npgsql's NpgsqlDataSource keeps a
    // dedicated pool per instance, not shared by connection string like classic NpgsqlConnection
    // pooling): S11-03 moved Accounts into Postgres, so every *EndpointsTests class now boots a
    // real app -- its own NpgsqlDataSource -- against this one container. At the default pool
    // size of 100 each, the container's own connection limit (Postgres default max_connections
    // = 100) was exhausted well before 30+ WebApplicationFactory instances got through the suite,
    // failing unrelated tests with "remaining connection slots are reserved for roles with the
    // SUPERUSER attribute". Every test here uses at most a handful of concurrent connections.
    private const int MaxPoolSizePerConnectionString = 5;

    public string AdminConnectionString => new NpgsqlConnectionStringBuilder(_container.GetConnectionString())
    {
        MaxPoolSize = MaxPoolSizePerConnectionString,
    }.ConnectionString;

    public string AppRoleConnectionString => new NpgsqlConnectionStringBuilder(_container.GetConnectionString())
    {
        Username = "app_role",
        Password = AppRolePassword,
        MaxPoolSize = MaxPoolSizePerConnectionString,
    }.ConnectionString;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();

        var migrationsDirectory = Path.Combine(AppContext.BaseDirectory, "migrations");
        await using var adminDataSource = NpgsqlDataSourceFactory.Create(AdminConnectionString);
        await MigrationRunner.RunAsync(adminDataSource, migrationsDirectory, AppRolePassword);
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();
}
