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

    public string AdminConnectionString => _container.GetConnectionString();

    public string AppRoleConnectionString => new NpgsqlConnectionStringBuilder(_container.GetConnectionString())
    {
        Username = "app_role",
        Password = AppRolePassword,
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
