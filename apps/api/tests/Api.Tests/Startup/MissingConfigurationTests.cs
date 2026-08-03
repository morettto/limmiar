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
        var entryPoint = typeof(Program).Assembly.EntryPoint
            ?? throw new InvalidOperationException("Api assembly has no entry point.");

        var args = new[] { "--migrate-only" };
        var invokeArgs = entryPoint.GetParameters().Length == 0
            ? []
            : new object?[] { args };

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            try
            {
                var result = entryPoint.Invoke(null, invokeArgs);
                if (result is Task task)
                {
                    await task;
                }
            }
            catch (System.Reflection.TargetInvocationException ex) when (ex.InnerException is not null)
            {
                // MethodInfo.Invoke wraps exceptions thrown by the invoked method.
                // Program's generated <Main>$ wrapper blocks synchronously on the async
                // body, so the missing-configuration throw surfaces here rather than
                // through a faulted Task -- unwrap it to assert on the real exception.
                throw ex.InnerException;
            }
        });

        Assert.Contains("ConnectionStrings:AdminDb", exception.Message);
    }

    [Fact]
    public async Task Main_WithMigrateOnlyFlagAndWithoutAppDbConnectionString_ThrowsInvalidOperationException()
    {
        var entryPoint = typeof(Program).Assembly.EntryPoint
            ?? throw new InvalidOperationException("Api assembly has no entry point.");

        var args = new[] { "--migrate-only" };
        var invokeArgs = entryPoint.GetParameters().Length == 0
            ? []
            : new object?[] { args };

        // AdminDb is set so the branch under test is the AppDb guard specifically, not the
        // earlier AdminDb one already covered above.
        Environment.SetEnvironmentVariable("ConnectionStrings__AdminDb", "Host=127.0.0.1;Port=1;Database=irrelevant");
        try
        {
            var exception = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
            {
                try
                {
                    var result = entryPoint.Invoke(null, invokeArgs);
                    if (result is Task task)
                    {
                        await task;
                    }
                }
                catch (System.Reflection.TargetInvocationException ex) when (ex.InnerException is not null)
                {
                    throw ex.InnerException;
                }
            });

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
        var entryPoint = typeof(Program).Assembly.EntryPoint
            ?? throw new InvalidOperationException("Api assembly has no entry point.");

        var args = new[] { "--migrate-only" };
        var invokeArgs = entryPoint.GetParameters().Length == 0
            ? []
            : new object?[] { args };

        Environment.SetEnvironmentVariable("ConnectionStrings__AdminDb", "Host=127.0.0.1;Port=1;Database=irrelevant");
        Environment.SetEnvironmentVariable("ConnectionStrings__AppDb", "Host=127.0.0.1;Port=1;Database=irrelevant;Username=app_role");
        try
        {
            var exception = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
            {
                try
                {
                    var result = entryPoint.Invoke(null, invokeArgs);
                    if (result is Task task)
                    {
                        await task;
                    }
                }
                catch (System.Reflection.TargetInvocationException ex) when (ex.InnerException is not null)
                {
                    throw ex.InnerException;
                }
            });

            Assert.Contains("must include a Password", exception.Message);
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__AdminDb", null);
            Environment.SetEnvironmentVariable("ConnectionStrings__AppDb", null);
        }
    }
}
