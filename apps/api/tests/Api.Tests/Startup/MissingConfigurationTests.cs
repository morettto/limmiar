using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Api.Tests.Startup;

/// <summary>Proves the defensive "missing configuration" guards in Program.cs fire -- no ConnectionStrings defaults exist in appsettings*.json, so every environment must supply them explicitly. In the "Database" collection so xUnit never runs this in parallel with MigrateOnlyStartupTests, since both manipulate the same process-wide ConnectionStrings__AdminDb environment variable.</summary>
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

    /// <summary>AppDb and WebAuthn settings (checked earlier in Program.Composition.cs) are set here so this test reaches the StaffAccess:ApiKey guard specifically, not an earlier one.</summary>
    [Fact]
    public void CreatingHost_WithoutStaffAccessApiKey_ThrowsInvalidOperationException()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
            });

        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains("StaffAccess:ApiKey", exception.Message);
    }

    [Fact]
    public void CreatingHost_WithoutWebAuthnRelyingPartyId_ThrowsInvalidOperationException()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
            });

        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains("WebAuthn:RelyingPartyId", exception.Message);
    }

    [Fact]
    public void CreatingHost_WithoutWebAuthnExpectedOrigin_ThrowsInvalidOperationException()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
            });

        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains("WebAuthn:ExpectedOrigin", exception.Message);
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
        // AdminDb is set so the branch under test is the AppDb guard specifically.
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
