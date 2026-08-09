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
                // App startup also needs StaffAccess:ApiKey/WebAuthn:RelyingPartyId/
                // WebAuthn:ExpectedOrigin configured (same "fail fast if missing" pattern as
                // ConnectionStrings:AppDb) even though this test never hits a staff-gated or
                // WebAuthn endpoint.
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
            });

        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
