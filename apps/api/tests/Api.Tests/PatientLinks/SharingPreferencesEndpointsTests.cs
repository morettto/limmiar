using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Accounts;
using Api.PatientLinks;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.PatientLinks;

/// <summary>
/// S11-02 fatia 2: HTTP round-trip for the sharing-preferences blob. The server never
/// interprets version/wrappedDek/ciphertext, only stores and compares the version counter.
/// Accounts live in Postgres (S11-03) -- real fixture + Respawn reset, same discipline as
/// SchedulingEndpointsTests.
/// </summary>
[Collection("Database")]
public sealed class SharingPreferencesEndpointsTests : IAsyncLifetime
{
    private const string ValidStubCode = "111111";

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public SharingPreferencesEndpointsTests(PostgresContainerFixture fixture)
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
    public async Task Put_ThenGet_ReturnsSameBlobWithVersion1()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterPatientAsync(client, "prefs-roundtrip@example.com");
        var wrappedDek = SomeBlob(0xD1);
        var ciphertext = SomeBlob(0xC1);

        var putResponse = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/sharing-preferences",
            new PutSharingPreferencesRequest(0, wrappedDek, ciphertext),
            PatientLinksJsonContext.Default.PutSharingPreferencesRequest);
        Assert.Equal(HttpStatusCode.OK, putResponse.StatusCode);
        var putView = await putResponse.Content.ReadFromJsonAsync(PatientLinksJsonContext.Default.SharingPreferencesVersionView);
        Assert.Equal(1, putView!.Version);

        var getResponse = await client.GetAsync($"/accounts/{accountId}/sharing-preferences");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var getView = await getResponse.Content.ReadFromJsonAsync(PatientLinksJsonContext.Default.SharingPreferencesView);

        Assert.Equal(1, getView!.Version);
        Assert.Equal(wrappedDek, getView.WrappedDek);
        Assert.Equal(ciphertext, getView.Ciphertext);
    }

    [Fact]
    public async Task Get_WhenNeverSaved_Returns404WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterPatientAsync(client, "prefs-never-saved@example.com");

        var response = await client.GetAsync($"/accounts/{accountId}/sharing-preferences");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("sharing.preferences_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Put_WithStaleExpectedVersion_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterPatientAsync(client, "prefs-stale@example.com");
        await client.PutAsJsonAsync(
            $"/accounts/{accountId}/sharing-preferences",
            new PutSharingPreferencesRequest(0, SomeBlob(0xD1), SomeBlob(0xC1)),
            PatientLinksJsonContext.Default.PutSharingPreferencesRequest);

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/sharing-preferences",
            new PutSharingPreferencesRequest(0, SomeBlob(0xD2), SomeBlob(0xC2)),
            PatientLinksJsonContext.Default.PutSharingPreferencesRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("sharing.version_conflict", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Put_WithNegativeVersion_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterPatientAsync(client, "prefs-negative-version@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/sharing-preferences",
            new PutSharingPreferencesRequest(-1, SomeBlob(0xD1), SomeBlob(0xC1)),
            PatientLinksJsonContext.Default.PutSharingPreferencesRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("expectedVersion", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_WithShortWrappedDek_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterPatientAsync(client, "prefs-short-wrapped-dek@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/sharing-preferences",
            new PutSharingPreferencesRequest(0, new byte[27], SomeBlob(0xC1)),
            PatientLinksJsonContext.Default.PutSharingPreferencesRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("wrappedDek", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_WithOversizedWrappedDek_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterPatientAsync(client, "prefs-oversized-wrapped-dek@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/sharing-preferences",
            new PutSharingPreferencesRequest(0, new byte[(64 * 1024) + 1], SomeBlob(0xC1)),
            PatientLinksJsonContext.Default.PutSharingPreferencesRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("wrappedDek", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_WithShortCiphertext_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterPatientAsync(client, "prefs-short-ciphertext@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/sharing-preferences",
            new PutSharingPreferencesRequest(0, SomeBlob(0xD1), new byte[27]),
            PatientLinksJsonContext.Default.PutSharingPreferencesRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("ciphertext", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_WithOversizedCiphertext_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterPatientAsync(client, "prefs-oversized-ciphertext@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/sharing-preferences",
            new PutSharingPreferencesRequest(0, SomeBlob(0xD1), new byte[(64 * 1024) + 1]),
            PatientLinksJsonContext.Default.PutSharingPreferencesRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("ciphertext", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PutAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/sharing-preferences",
            new PutSharingPreferencesRequest(0, SomeBlob(0xD1), SomeBlob(0xC1)),
            PatientLinksJsonContext.Default.PutSharingPreferencesRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Put_WithTokenForDifferentAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterPatientAsync(client, "prefs-put-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterPatientAsync(otherClient, "prefs-put-wrong-owner-target@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{otherAccountId}/sharing-preferences",
            new PutSharingPreferencesRequest(0, SomeBlob(0xD1), SomeBlob(0xC1)),
            PatientLinksJsonContext.Default.PutSharingPreferencesRequest);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Get_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/accounts/{Guid.NewGuid()}/sharing-preferences");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Get_WithTokenForDifferentAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterPatientAsync(client, "prefs-get-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterPatientAsync(otherClient, "prefs-get-wrong-owner-target@example.com");

        var response = await client.GetAsync($"/accounts/{otherAccountId}/sharing-preferences");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private static byte[] SomeBlob(byte fill)
    {
        var blob = new byte[28];
        Array.Fill(blob, fill);
        return blob;
    }

    private static async Task<Guid> RegisterPatientAsync(HttpClient client, string email)
    {
        var registerResponse = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest(email, SomeVerifier, AccountRole.Patient),
            AccountsJsonContext.Default.RegisterRequest);
        var registered = await registerResponse.Content.ReadFromJsonAsync(AccountsJsonContext.Default.RegisterResponse);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", registered!.AccessToken);
        return registered.Id;
    }

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountVerifierLengths.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
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
                builder.ConfigureTestServices(services =>
                {
                    services.AddSingleton<ITotpProvider>(new StubTotpProvider());
                    services.AddSingleton<ICouncilRegistryVerifier>(new StubCouncilRegistryVerifier());
                });
            });

    private sealed class StubTotpProvider : ITotpProvider
    {
        public string GenerateSecret() => "STUBBEDSECRET";

        public string BuildProvisioningUri(string secret, string accountEmail, string issuer) =>
            $"otpauth://totp/{issuer}:{accountEmail}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30";

        public bool ValidateCode(string secret, string code, DateTimeOffset timestamp) => code == ValidStubCode;
    }

    private sealed class StubCouncilRegistryVerifier : ICouncilRegistryVerifier
    {
        public Task<CouncilRegistryVerificationResult> VerifyAsync(
            ProfessionalCredentialType type, string registryNumber, string registryUf, CancellationToken cancellationToken) =>
            Task.FromResult(CouncilRegistryVerificationResult.CreateVerified());
    }
}
