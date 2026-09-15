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
/// S11-02 fatia 1: HTTP round-trip for the two shared-items routes. The server only ever sees
/// ciphertext -- these tests never decrypt, they only prove the bytes travel unchanged and that
/// authorization is exactly "there is a link in this direction". Accounts live in Postgres
/// (S11-03) -- real fixture + Respawn reset, same discipline as SchedulingEndpointsTests.
/// </summary>
[Collection("Database")]
public sealed class SharedItemEndpointsTests : IAsyncLifetime
{
    private const string ValidStubCode = "111111";

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public SharedItemEndpointsTests(PostgresContainerFixture fixture)
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
    public async Task PatientShares_ThenProfessionalLists_ReturnsSameCiphertext()
    {
        using var factory = CreateFactory();
        using var professionalClient = factory.CreateClient();
        var professionalId = await RegisterActiveProfessionalAsync(professionalClient, "shared-professional@example.com");

        using var patientClient = factory.CreateClient();
        var patientAccountId = await RegisterPatientAsync(patientClient, "shared-patient@example.com");
        await LinkAsync(professionalClient, professionalId, patientClient, patientAccountId);

        var ciphertext = SomeCiphertext(0xC1);
        var shareResponse = await patientClient.PostAsJsonAsync(
            $"/accounts/{patientAccountId}/links/{professionalId}/shared-items",
            new ShareItemRequest(ciphertext),
            PatientLinksJsonContext.Default.ShareItemRequest);
        Assert.Equal(HttpStatusCode.NoContent, shareResponse.StatusCode);

        var listResponse = await professionalClient.GetAsync($"/accounts/{professionalId}/links/{patientAccountId}/shared-items");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var items = await listResponse.Content.ReadFromJsonAsync(PatientLinksJsonContext.Default.IReadOnlyListSharedItemView);

        Assert.NotNull(items);
        Assert.Single(items!);
        Assert.Equal(ciphertext, items![0].Ciphertext);
    }

    /// <summary>accountId is the professional side here -- Share only travels patient -> professional, so this direction has no link.</summary>
    [Fact]
    public async Task Post_WhenAccountIsProfessionalSide_Returns404()
    {
        using var factory = CreateFactory();
        using var professionalClient = factory.CreateClient();
        var professionalId = await RegisterActiveProfessionalAsync(professionalClient, "shared-post-wrong-side-professional@example.com");

        using var patientClient = factory.CreateClient();
        var patientAccountId = await RegisterPatientAsync(patientClient, "shared-post-wrong-side-patient@example.com");
        await LinkAsync(professionalClient, professionalId, patientClient, patientAccountId);

        var response = await professionalClient.PostAsJsonAsync(
            $"/accounts/{professionalId}/links/{patientAccountId}/shared-items",
            new ShareItemRequest(SomeCiphertext()),
            PatientLinksJsonContext.Default.ShareItemRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("link.not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>accountId is the patient side here -- ListShared only reads professional -> patient, so this direction has no link.</summary>
    [Fact]
    public async Task Get_WhenAccountIsPatientSide_Returns404()
    {
        using var factory = CreateFactory();
        using var professionalClient = factory.CreateClient();
        var professionalId = await RegisterActiveProfessionalAsync(professionalClient, "shared-get-wrong-side-professional@example.com");

        using var patientClient = factory.CreateClient();
        var patientAccountId = await RegisterPatientAsync(patientClient, "shared-get-wrong-side-patient@example.com");
        await LinkAsync(professionalClient, professionalId, patientClient, patientAccountId);

        var response = await patientClient.GetAsync($"/accounts/{patientAccountId}/links/{professionalId}/shared-items");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("link.not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Get_AfterUnlink_Returns404()
    {
        using var factory = CreateFactory();
        using var professionalClient = factory.CreateClient();
        var professionalId = await RegisterActiveProfessionalAsync(professionalClient, "shared-unlink-professional@example.com");

        using var patientClient = factory.CreateClient();
        var patientAccountId = await RegisterPatientAsync(patientClient, "shared-unlink-patient@example.com");
        await LinkAsync(professionalClient, professionalId, patientClient, patientAccountId);
        await patientClient.PostAsJsonAsync(
            $"/accounts/{patientAccountId}/links/{professionalId}/shared-items",
            new ShareItemRequest(SomeCiphertext()),
            PatientLinksJsonContext.Default.ShareItemRequest);

        await patientClient.DeleteAsync($"/accounts/{patientAccountId}/links/{professionalId}");
        var response = await professionalClient.GetAsync($"/accounts/{professionalId}/links/{patientAccountId}/shared-items");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("link.not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Post_WithShortCiphertext_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var professionalClient = factory.CreateClient();
        var professionalId = await RegisterActiveProfessionalAsync(professionalClient, "shared-short-professional@example.com");

        using var patientClient = factory.CreateClient();
        var patientAccountId = await RegisterPatientAsync(patientClient, "shared-short-patient@example.com");
        await LinkAsync(professionalClient, professionalId, patientClient, patientAccountId);

        var response = await patientClient.PostAsJsonAsync(
            $"/accounts/{patientAccountId}/links/{professionalId}/shared-items",
            new ShareItemRequest(new byte[27]),
            PatientLinksJsonContext.Default.ShareItemRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("ciphertext", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task Post_WithOversizedCiphertext_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var professionalClient = factory.CreateClient();
        var professionalId = await RegisterActiveProfessionalAsync(professionalClient, "shared-oversized-professional@example.com");

        using var patientClient = factory.CreateClient();
        var patientAccountId = await RegisterPatientAsync(patientClient, "shared-oversized-patient@example.com");
        await LinkAsync(professionalClient, professionalId, patientClient, patientAccountId);

        var response = await patientClient.PostAsJsonAsync(
            $"/accounts/{patientAccountId}/links/{professionalId}/shared-items",
            new ShareItemRequest(new byte[(64 * 1024) + 1]),
            PatientLinksJsonContext.Default.ShareItemRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("ciphertext", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task Post_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/links/{Guid.NewGuid()}/shared-items",
            new ShareItemRequest(SomeCiphertext()),
            PatientLinksJsonContext.Default.ShareItemRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Post_WithTokenForDifferentAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterPatientAsync(client, "shared-post-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterPatientAsync(otherClient, "shared-post-wrong-owner-target@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{otherAccountId}/links/{Guid.NewGuid()}/shared-items",
            new ShareItemRequest(SomeCiphertext()),
            PatientLinksJsonContext.Default.ShareItemRequest);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Get_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/accounts/{Guid.NewGuid()}/links/{Guid.NewGuid()}/shared-items");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Get_WithTokenForDifferentAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterPatientAsync(client, "shared-get-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterPatientAsync(otherClient, "shared-get-wrong-owner-target@example.com");

        var response = await client.GetAsync($"/accounts/{otherAccountId}/links/{Guid.NewGuid()}/shared-items");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private static async Task LinkAsync(HttpClient professionalClient, Guid professionalId, HttpClient patientClient, Guid patientAccountId)
    {
        var inviteResponse = await professionalClient.PostAsync($"/accounts/{professionalId}/patients/{Guid.NewGuid()}/link-invites", null);
        var invite = await inviteResponse.Content.ReadFromJsonAsync(PatientLinksJsonContext.Default.CreateLinkInviteResponse);
        await patientClient.PostAsJsonAsync(
            $"/accounts/{patientAccountId}/links",
            new RedeemLinkRequest(invite!.Code),
            PatientLinksJsonContext.Default.RedeemLinkRequest);
    }

    private static byte[] SomeCiphertext(byte fill = 0x01)
    {
        var blob = new byte[28];
        Array.Fill(blob, fill);
        return blob;
    }

    private static async Task<Guid> RegisterActiveProfessionalAsync(HttpClient client, string email)
    {
        var accountId = await RegisterProfessionalWithoutVerificationAsync(client, email);

        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crp, "06/123456", "SP", null),
            AccountsJsonContext.Default.SubmitProfessionalCredentialRequest);

        return accountId;
    }

    private static async Task<Guid> RegisterProfessionalWithoutVerificationAsync(HttpClient client, string email)
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
                builder.UseSetting("Totp:EncryptionKey", TotpTestEncryptionKey.Base64);
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
