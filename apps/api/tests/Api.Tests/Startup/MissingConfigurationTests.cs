using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Api.Tests.Startup;

/// <summary>
/// Proves the defensive "missing configuration" guards in Program.cs actually fire.
/// Deliberately no ConnectionStrings defaults exist in appsettings*.json (never commit
/// database credentials, even placeholder ones, to source control) -- every environment
/// (tests, Docker, Fly) must supply ConnectionStrings__AppDb / ConnectionStrings__AdminDb
/// explicitly. These tests exercise what happens when that requirement isn't met.
/// </summary>
/// <remarks>
/// In the "Database" collection (not because it needs the Postgres container, but so
/// xUnit never runs it in parallel with MigrateOnlyStartupTests -- both manipulate the
/// same process-wide ConnectionStrings__AdminDb environment variable, and tests in
/// different collections can run concurrently by default).
/// </remarks>
[Collection("Database")]
public sealed class MissingConfigurationTests
{
    [Fact]
    public void CreatingHost_WithoutAppDbConnectionString_ThrowsInvalidOperationException()
    {
        using var factory = new WebApplicationFactory<Program>();

        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains("ConnectionStrings:AppDb", exception.Message);
    }

    [Fact]
    public async Task Main_WithMigrateOnlyFlagAndWithoutAdminDbConnectionString_ThrowsInvalidOperationException()
    {
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(MigrateOnlyEntryPoint.InvokeAsync);

        Assert.Contains("ConnectionStrings:AdminDb", exception.Message);
    }

    [Fact]
    public async Task Main_WithMigrateOnlyFlagAndWithoutAppDbConnectionString_ThrowsInvalidOperationException()
    {
        // AdminDb is set so the branch under test is the AppDb guard specifically, not the
        // earlier AdminDb one already covered above.
        Environment.SetEnvironmentVariable("ConnectionStrings__AdminDb", "Host=127.0.0.1;Port=1;Database=irrelevant");
        try
        {
            var exception = await Assert.ThrowsAsync<InvalidOperationException>(MigrateOnlyEntryPoint.InvokeAsync);

            Assert.Contains("ConnectionStrings:AppDb", exception.Message);
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__AdminDb", null);
        }
    }

    [Fact]
    public async Task Main_WithMigrateOnlyFlagAndAppDbWithoutPassword_ThrowsInvalidOperationException()
    {
        Environment.SetEnvironmentVariable("ConnectionStrings__AdminDb", "Host=127.0.0.1;Port=1;Database=irrelevant");
        Environment.SetEnvironmentVariable("ConnectionStrings__AppDb", "Host=127.0.0.1;Port=1;Database=irrelevant;Username=app_role");
        try
        {
            var exception = await Assert.ThrowsAsync<InvalidOperationException>(MigrateOnlyEntryPoint.InvokeAsync);

            Assert.Contains("must include a Password", exception.Message);
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__AdminDb", null);
            Environment.SetEnvironmentVariable("ConnectionStrings__AppDb", null);
        }
    }
}
