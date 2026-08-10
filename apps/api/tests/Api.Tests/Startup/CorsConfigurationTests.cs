using Microsoft.AspNetCore.Mvc.Testing;

namespace Api.Tests.Startup;

/// <summary>Proves Program.Composition.cs's Cors:AllowedOrigins branch: an empty allow-list (the default, covered by every other WebApplicationFactory test) versus a configured one that actually opens CORS for that origin.</summary>
public sealed class CorsConfigurationTests
{
    private const string AllowedOrigin = "https://app.example.com";

    [Fact]
    public async Task GetHealth_WithConfiguredAllowedOriginAndMatchingOriginHeader_ReturnsAccessControlAllowOriginHeader()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
                builder.UseSetting("Cors:AllowedOrigins:0", AllowedOrigin);
            });
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", AllowedOrigin);

        var response = await client.SendAsync(request);

        Assert.True(response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values));
        Assert.Equal(AllowedOrigin, Assert.Single(values!));
    }

    /// <summary>Same request, but from an origin absent from the allow-list -- the header must not appear.</summary>
    [Fact]
    public async Task GetHealth_WithConfiguredAllowedOriginAndDifferentOriginHeader_ReturnsNoAccessControlAllowOriginHeader()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
                builder.UseSetting("Cors:AllowedOrigins:0", AllowedOrigin);
            });
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", "https://not-allowed.example.com");

        var response = await client.SendAsync(request);

        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }
}
