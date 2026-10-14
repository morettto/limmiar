using System.Net;
using System.Text.Json;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Api.Tests.RateLimiting;

/// <summary>
/// Every request here is rejected before its handler (no body, so binding fails) or by the limiter
/// itself, so no test needs a database. Clients are told apart by Fly-Client-IP, the header the
/// production proxy sets and the app trusts.
/// </summary>
public sealed class RateLimitingTests
{
    private const string AccountId = "3f2c9a52-6d7e-4c58-9b0a-7a1d1e5b8c01";
    private const string OtherAccountId = "8d14e7b0-2c1a-4f6e-a5d3-90b2c4e6f711";

    public static TheoryData<string, int> IpLimitedRoutes => new()
    {
        { "/auth/login", 30 },
        { "/auth/magic-link/verify", 30 },
        { "/devices/pairing-sessions/abc/claim", 10 },
        { "/webhooks/abacatepay", 120 },
    };

    public static TheoryData<string, int> AccountLimitedRoutes => new()
    {
        { $"/accounts/{AccountId}/totp/challenge", 5 },
        { $"/accounts/{AccountId}/recovery-phrase", 5 },
    };

    private static WebApplicationFactory<Program> CreateFactory(string environment = "Development", bool disabled = false) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
            builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
            builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
            builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
            builder.UseSetting("AbacatePay:WebhookSecret", "whsec_test123");
            builder.UseSetting("AbacatePay:ApiKey", "test-abacate-key");
            builder.UseSetting("Totp:EncryptionKey", TotpTestEncryptionKey.Base64);
            builder.UseSetting("RateLimiting:Disabled", disabled ? "true" : "false");
        });

    private static async Task<HttpResponseMessage> PostAsync(HttpClient client, string path, string clientIp)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        request.Headers.Add("Fly-Client-IP", clientIp);
        return await client.SendAsync(request);
    }

    private static async Task ExhaustAsync(HttpClient client, string path, int limit, string clientIp)
    {
        for (var attempt = 0; attempt < limit; attempt++)
        {
            using var response = await PostAsync(client, path, clientIp);
            Assert.NotEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
        }
    }

    [Theory]
    [MemberData(nameof(IpLimitedRoutes))]
    public async Task IpLimitedRoute_AfterTheLimit_ReturnsProblemJson429WithOwnCodeAndRetryAfter(string path, int limit)
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await ExhaustAsync(client, path, limit, "203.0.113.7");

        using var response = await PostAsync(client, path, "203.0.113.7");

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("60", Assert.Single(response.Headers.GetValues("Retry-After")));
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("rate_limit.too_many_requests", body.RootElement.GetProperty("code").GetString());
        Assert.Equal(429, body.RootElement.GetProperty("status").GetInt32());
    }

    [Theory]
    [MemberData(nameof(IpLimitedRoutes))]
    public async Task IpLimitedRoute_ExhaustedByOneClientIp_StillServesAnotherClientIp(string path, int limit)
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await ExhaustAsync(client, path, limit, "203.0.113.7");

        using var response = await PostAsync(client, path, "198.51.100.9");

        Assert.NotEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(AccountLimitedRoutes))]
    public async Task AccountLimitedRoute_AfterTheLimit_Returns429EvenFromAnotherClientIp(string path, int limit)
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await ExhaustAsync(client, path, limit, "203.0.113.7");

        using var response = await PostAsync(client, path, "198.51.100.9");

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(AccountLimitedRoutes))]
    public async Task AccountLimitedRoute_ExhaustedForOneAccount_StillServesAnotherAccount(string path, int limit)
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await ExhaustAsync(client, path, limit, "203.0.113.7");

        using var response = await PostAsync(client, path.Replace(AccountId, OtherAccountId), "203.0.113.7");

        Assert.NotEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
    }

    /// <summary>Without this the same GUID in upper case would get a fresh bucket on every attempt.</summary>
    [Fact]
    public async Task AccountLimitedRoute_SameAccountInAnotherCasing_SharesTheBucket()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await ExhaustAsync(client, $"/accounts/{AccountId}/totp/challenge", 5, "203.0.113.7");

        using var response = await PostAsync(client, $"/accounts/{AccountId.ToUpperInvariant()}/totp/challenge", "203.0.113.7");

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
    }

    [Fact]
    public async Task Requests_WithoutForwardedClientIp_ShareTheUnknownClientBucket()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        for (var attempt = 0; attempt < 30; attempt++)
        {
            using var accepted = await client.PostAsync("/auth/login", content: null);
            Assert.NotEqual(HttpStatusCode.TooManyRequests, accepted.StatusCode);
        }

        using var response = await client.PostAsync("/auth/login", content: null);

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
    }

    [Fact]
    public async Task UnlimitedRoutesAndUnknownPaths_AreNeverThrottled()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        for (var attempt = 0; attempt < 150; attempt++)
        {
            using var health = await client.GetAsync("/health");
            using var unknown = await client.GetAsync("/no-such-route");
            Assert.Equal(HttpStatusCode.OK, health.StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        }
    }

    [Fact]
    public async Task Disabled_NeverThrottles()
    {
        using var factory = CreateFactory(disabled: true);
        using var client = factory.CreateClient();

        for (var attempt = 0; attempt < 40; attempt++)
        {
            using var response = await PostAsync(client, "/auth/login", "203.0.113.7");
            Assert.NotEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
        }
    }

    [Fact]
    public async Task Production_OverHttpsBehindTheProxy_SendsStrictTransportSecurity()
    {
        using var factory = CreateFactory("Production");
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Host = "api.limmiar.test";
        request.Headers.Add("X-Forwarded-Proto", "https");
        request.Headers.Add("Fly-Client-IP", "203.0.113.7");

        using var response = await client.SendAsync(request);

        Assert.Equal("max-age=31536000; includeSubDomains", Assert.Single(response.Headers.GetValues("Strict-Transport-Security")));
    }

    [Fact]
    public async Task Development_NeverSendsStrictTransportSecurity()
    {
        using var factory = CreateFactory("Development");
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Host = "api.limmiar.test";
        request.Headers.Add("X-Forwarded-Proto", "https");

        using var response = await client.SendAsync(request);

        Assert.False(response.Headers.Contains("Strict-Transport-Security"));
    }
}
