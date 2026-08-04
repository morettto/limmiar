using System.Net;
using System.Text.Json;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Api.Tests.Health;

[Collection("Database")]
public sealed class HealthDbEndpointTests
{
    private readonly PostgresContainerFixture _fixture;

    public HealthDbEndpointTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task GetHealthDb_WhenDatabaseUnreachable_Returns503WithProblemDetails()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                // Port 1 refuses connections instantly on loopback -- deterministic,
                // no container or network flakiness involved.
                builder.UseSetting(
                    "ConnectionStrings:AppDb",
                    "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;Timeout=2;");
            });

        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health/db");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("health.database_unreachable", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal(503, doc.RootElement.GetProperty("status").GetInt32());
    }

    [Fact]
    public async Task GetHealthDb_WhenDatabaseReachable_Returns200()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", _fixture.AppRoleConnectionString);
            });

        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health/db");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
