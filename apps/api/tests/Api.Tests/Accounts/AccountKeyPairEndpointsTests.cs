using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Accounts;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.Accounts;

/// <summary>
/// S11-04 fatia 1: PUT/GET the account's X25519 key pair envelope (own table,
/// account_key_pairs, since S11-03 fatia 6). Accounts and key pairs live in Postgres -- real
/// fixture + Respawn reset, same discipline as SchedulingEndpointsTests.
/// </summary>
[Collection("Database")]
public sealed class AccountKeyPairEndpointsTests : IAsyncLifetime
{
    private const string ValidStubCode = "111111";

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public AccountKeyPairEndpointsTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    public async Task InitializeAsync()
    {
        await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await adminConnection.OpenAsync();

        _respawner = await Respawner.CreateAsync(adminConnection, new RespawnerOptions
        {
            SchemasToInclude = ["public"],
            DbAdapter = DbAdapter.Postgres,
        });
        await _respawner.ResetAsync(adminConnection);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    [Fact]
    public async Task PutKeyPair_ThenGet_ReturnsSameEnvelope()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "keypair-put@example.com");
        var publicKey = SomePublicKey(0x01);
        var wrappedDek = SomeSealedBlob(0x02);
        var sealedPrivateKey = SomeSealedBlob(0x03);

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/key-pair",
            new AccountKeyPairRequest(publicKey, wrappedDek, sealedPrivateKey),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var getResponse = await client.GetAsync($"/accounts/{accountId}/key-pair");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var body = await getResponse.Content.ReadFromJsonAsync(AccountsJsonContext.Default.AccountKeyPairResponse);
        Assert.NotNull(body);
        Assert.Equal(publicKey, body!.PublicKey);
        Assert.Equal(wrappedDek, body.WrappedDek);
        Assert.Equal(sealedPrivateKey, body.SealedPrivateKey);
    }

    [Fact]
    public async Task PutKeyPair_WithWrongPublicKeyLength_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "keypair-wrong-length@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/key-pair",
            new AccountKeyPairRequest([0xAA], SomeSealedBlob(0x02), SomeSealedBlob(0x03)),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("publicKey", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PutKeyPair_WithTooShortWrappedDek_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "keypair-short-dek@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/key-pair",
            new AccountKeyPairRequest(SomePublicKey(0x01), [0xAA], SomeSealedBlob(0x03)),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("wrappedDek", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>Same floor validation applies to sealedPrivateKey, checked after wrappedDek -- own call site, own test.</summary>
    [Fact]
    public async Task PutKeyPair_WithTooShortSealedPrivateKey_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "keypair-short-private@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/key-pair",
            new AccountKeyPairRequest(SomePublicKey(0x01), SomeSealedBlob(0x02), [0xAA]),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("sealedPrivateKey", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PutKeyPair_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PutAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/key-pair",
            new AccountKeyPairRequest(SomePublicKey(0x01), SomeSealedBlob(0x02), SomeSealedBlob(0x03)),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A "Bearer " prefix with a token that fails ValidateAccess (malformed/unknown) is 401 -- RequireAccountAccessMiddleware's invalid-token branch, distinct from "no header at all".</summary>
    [Fact]
    public async Task PutKeyPair_WithMalformedBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "not-a-real-token");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/key-pair",
            new AccountKeyPairRequest(SomePublicKey(0x01), SomeSealedBlob(0x02), SomeSealedBlob(0x03)),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A valid bearer token for a DIFFERENT account than the one in the route is 403, not 401 (RFC 9110) -- RequireAccountAccessMiddleware.</summary>
    [Fact]
    public async Task PutKeyPair_WithTokenForDifferentAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterProfessionalAsync(client, "keypair-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterProfessionalAsync(otherClient, "keypair-wrong-owner-target@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{otherAccountId}/key-pair",
            new AccountKeyPairRequest(SomePublicKey(0x01), SomeSealedBlob(0x02), SomeSealedBlob(0x03)),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.forbidden", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task GetKeyPair_WithoutPriorPublish_Returns404WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "keypair-get-404@example.com");

        var response = await client.GetAsync($"/accounts/{accountId}/key-pair");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("key_pair.not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task GetKeyPair_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/accounts/{Guid.NewGuid()}/key-pair");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GetKeyPair_WithTokenForDifferentAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterProfessionalAsync(client, "keypair-get-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterProfessionalAsync(otherClient, "keypair-get-wrong-owner-target@example.com");

        var response = await client.GetAsync($"/accounts/{otherAccountId}/key-pair");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>Publishing the same publicKey again replaces the envelope (rewrap), 204, never 409.</summary>
    [Fact]
    public async Task PutKeyPair_TwiceWithSamePublicKey_SecondReplacesTheEnvelope()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "keypair-same-pubkey@example.com");
        var publicKey = SomePublicKey(0x01);
        await client.PutAsJsonAsync(
            $"/accounts/{accountId}/key-pair",
            new AccountKeyPairRequest(publicKey, SomeSealedBlob(0x02), SomeSealedBlob(0x03)),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        var secondWrappedDek = SomeSealedBlob(0x04);
        var secondSealedPrivateKey = SomeSealedBlob(0x05);
        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/key-pair",
            new AccountKeyPairRequest(publicKey, secondWrappedDek, secondSealedPrivateKey),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var getResponse = await client.GetAsync($"/accounts/{accountId}/key-pair");
        var body = await getResponse.Content.ReadFromJsonAsync(AccountsJsonContext.Default.AccountKeyPairResponse);
        Assert.NotNull(body);
        Assert.Equal(secondWrappedDek, body!.WrappedDek);
        Assert.Equal(secondSealedPrivateKey, body.SealedPrivateKey);
    }

    /// <summary>A different publicKey than the one already published is 409 -- the first publication wins, two devices racing converge on the same pair.</summary>
    [Fact]
    public async Task PutKeyPair_WithDifferentPublicKeyThanAlreadyPublished_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "keypair-conflict@example.com");
        await client.PutAsJsonAsync(
            $"/accounts/{accountId}/key-pair",
            new AccountKeyPairRequest(SomePublicKey(0x01), SomeSealedBlob(0x02), SomeSealedBlob(0x03)),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/key-pair",
            new AccountKeyPairRequest(SomePublicKey(0x02), SomeSealedBlob(0x04), SomeSealedBlob(0x05)),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("key_pair.public_key_conflict", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A real access token can never resolve to an unknown account, so this swaps in a stub that treats any GUID-shaped bearer token as proof for that exact account, reaching AccountKeyPairService's AccountNotFound branch in isolation -- same technique as VoiceEnrollmentEndpointsTests.</summary>
    [Fact]
    public async Task PutKeyPair_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/key-pair",
            new AccountKeyPairRequest(SomePublicKey(0x01), SomeSealedBlob(0x02), SomeSealedBlob(0x03)),
            AccountsJsonContext.Default.AccountKeyPairRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Same bypass technique as the PUT test above, reaching AccountKeyPairService.GetAsync with an account that does not exist -- GET does not distinguish "unknown account" from "account exists but never published a key pair" (same as VoiceEnrollmentEndpointsTests.GetVoiceEnrollment_WithUnknownAccountId), both are key_pair.not_found.</summary>
    [Fact]
    public async Task GetKeyPair_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.GetAsync($"/accounts/{accountId}/key-pair");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("key_pair.not_found", doc.RootElement.GetProperty("code").GetString());
    }

    private static async Task<Guid> RegisterProfessionalAsync(HttpClient client, string email)
    {
        var registerResponse = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest(email, SomeVerifier, AccountRole.Professional),
            AccountsJsonContext.Default.RegisterRequest);
        var registered = await registerResponse.Content.ReadFromJsonAsync(AccountsJsonContext.Default.RegisterResponse);
        var accountId = registered!.Id;
        var ticket = registered.TwoFactorTicket!;

        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/totp",
            new BeginTotpEnrollmentRequest(ticket),
            AccountsJsonContext.Default.BeginTotpEnrollmentRequest);
        var confirmResponse = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/totp/confirm",
            new ConfirmTotpEnrollmentRequest(ticket, ValidStubCode),
            AccountsJsonContext.Default.ConfirmTotpEnrollmentRequest);
        var confirmed = await confirmResponse.Content.ReadFromJsonAsync(AccountsJsonContext.Default.ConfirmTotpEnrollmentResponse);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", confirmed!.AccessToken);
        return accountId;
    }

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountVerifierLengths.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }

    private static byte[] SomePublicKey(byte fill)
    {
        var key = new byte[32];
        Array.Fill(key, fill);
        return key;
    }

    /// <summary>A structurally valid (>= the 28-byte AES-GCM floor) opaque blob -- same helper shape as VoiceEnrollmentEndpointsTests.SomeSealedBlob.</summary>
    private static byte[] SomeSealedBlob(byte fill)
    {
        var blob = new byte[28];
        Array.Fill(blob, fill);
        return blob;
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", _fixture.AppRoleConnectionString);
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
                builder.UseSetting("AbacatePay:WebhookSecret", "whsec_test123");
                builder.ConfigureTestServices(services => services.AddSingleton<ITotpProvider>(new StubTotpProvider()));
            });

    private WebApplicationFactory<Program> CreateFactoryWithSessionBypass() =>
        CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<ISessionTokenIssuer>(new AlwaysValidSessionTokenIssuer())));

    private sealed class StubTotpProvider : ITotpProvider
    {
        public string GenerateSecret() => "STUBBEDSECRET";

        public string BuildProvisioningUri(string secret, string accountEmail, string issuer) =>
            $"otpauth://totp/{issuer}:{accountEmail}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30";

        public bool ValidateCode(string secret, string code, DateTimeOffset timestamp) => code == ValidStubCode;
    }

    private sealed class AlwaysValidSessionTokenIssuer : ISessionTokenIssuer
    {
        public SessionTokenPair IssuePair(Guid accountId) => throw new NotSupportedException("not needed by the tests that use this stub");

        public RefreshSessionResult Refresh(string refreshToken) => throw new NotSupportedException("not needed by the tests that use this stub");

        public Guid? ValidateAccess(string accessToken) => Guid.TryParse(accessToken, out var accountId) ? accountId : null;
    }
}
