using Api.Data;
using Api.Endpoints;
using Api.Serialization;
using Npgsql;

var builder = WebApplication.CreateSlimBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, ApiJsonSerializerContext.Default);
});

builder.Services.AddOpenApi();

// Fly.io's release_command runs this exact binary with --migrate-only before the new
// version starts serving traffic. This is the SAME MigrationRunner used by the
// Testcontainers-backed integration test fixture -- no duplicated migration logic.
if (args.Contains("--migrate-only"))
{
    var adminConnectionString = builder.Configuration.GetConnectionString("AdminDb")
        ?? throw new InvalidOperationException("Missing required configuration: ConnectionStrings:AdminDb");
    var appConnectionString = builder.Configuration.GetConnectionString("AppDb")
        ?? throw new InvalidOperationException("Missing required configuration: ConnectionStrings:AppDb");

    // app_role's password is never a literal in the migration SQL -- it is derived from
    // the same AppDb secret the running application connects with, so rotating that one
    // Fly secret and redeploying is also how this role's database password gets rotated.
    var appRolePassword = new NpgsqlConnectionStringBuilder(appConnectionString).Password
        ?? throw new InvalidOperationException("ConnectionStrings:AppDb must include a Password.");

    var migrationsDirectory = Path.Combine(AppContext.BaseDirectory, "migrations");
    await using var adminDataSource = NpgsqlDataSourceFactory.Create(adminConnectionString);
    await MigrationRunner.RunAsync(adminDataSource, migrationsDirectory, appRolePassword);
}
else
{
    var appConnectionString = builder.Configuration.GetConnectionString("AppDb")
        ?? throw new InvalidOperationException("Missing required configuration: ConnectionStrings:AppDb");

    builder.Services.AddSingleton(NpgsqlDataSourceFactory.Create(appConnectionString));

    var app = builder.Build();

    if (app.Environment.IsDevelopment())
    {
        app.MapOpenApi();
    }

    app.MapHealthEndpoints();

    app.Run();
}
