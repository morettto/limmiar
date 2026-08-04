using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Api.Tests.Health;

public sealed class HealthEndpointTests
{
    [Fact]
    public async Task GetHealth_ReturnsOk()
    {
        // Liveness never touches the database, but app startup still needs a
        // syntactically valid ConnectionStrings:AppDb to construct the NpgsqlDataSource
        // singleton (which does not actually connect until first use).
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
            });

        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
