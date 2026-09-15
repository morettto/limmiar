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
/// S11-04 fatia 3: HTTP round-trip for the 4 PatientLinks routes. Accounts live in Postgres
/// (S11-03); PatientLinkStore itself is still in memory -- real fixture + Respawn reset only
/// because the app now needs Postgres to boot at all, same discipline as
/// SchedulingEndpointsTests.
/// </summary>
[Collection("Database")]
public sealed class PatientLinkEndpointsTests : IAsyncLifetime
{
    private const string ValidStubCode = "111111";

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public PatientLinkEndpointsTests(PostgresContainerFixture fixture)
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
    public async Task InviteThenRedeem_BothSidesListLinkWithPeerPublicKey()
    {
        using var factory = CreateFactory();
        using var professionalClient = factory.CreateClient();
        var professionalId = await RegisterActiveProfessionalAsync(professionalClient, "link-professional@example.com");
        await PublishKeyPairAsync(professionalClient, professionalId, 0xA1);

        using var patientClient = factory.CreateClient();
        var patientAccountId = await RegisterPatientAsync(patientClient, "link-patient@example.com");
        await PublishKeyPairAsync(patientClient, patientAccountId, 0xB2);

        var patientId = Guid.NewGuid();
        var inviteResponse = await professionalClient.PostAsync(
            $"/accounts/{professionalId}/patients/{patientId}/link-invites", null);
        Assert.Equal(HttpStatusCode.Created, inviteResponse.StatusCode);
        var invite = await inviteResponse.Content.ReadFromJsonAsync(PatientLinksJsonContext.Default.CreateLinkInviteResponse);
        Assert.NotNull(invite);
        Assert.Equal(12, invite!.Code.Length);

        var redeemResponse = await patientClient.PostAsJsonAsync(
            $"/accounts/{patientAccountId}/links",
            new RedeemLinkRequest(invite.Code),
            PatientLinksJsonContext.Default.RedeemLinkRequest);
        Assert.Equal(HttpStatusCode.Created, redeemResponse.StatusCode);
        var redeemed = await redeemResponse.Content.ReadFromJsonAsync(PatientLinksJsonContext.Default.LinkView);
        Assert.NotNull(redeemed);
        Assert.Equal(professionalId, redeemed!.ProfessionalAccountId);
        Assert.Equal(patientAccountId, redeemed.PatientAccountId);
        Assert.Equal(patientId, redeemed.PatientId);
        Assert.Equal(SomePublicKey(0xA1), redeemed.PeerPublicKey);

        var professionalLinks = await GetLinksAsync(professionalClient, professionalId);
        Assert.Single(professionalLinks);
        Assert.Equal(SomePublicKey(0xB2), professionalLinks[0].PeerPublicKey);

        var patientLinks = await GetLinksAsync(patientClient, patientAccountId);
        Assert.Single(patientLinks);
        Assert.Equal(SomePublicKey(0xA1), patientLinks[0].PeerPublicKey);
    }

    [Fact]
    public async Task CreateInvite_ByUnverifiedProfessional_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalWithoutVerificationAsync(client, "link-unverified@example.com");

        var response = await client.PostAsync($"/accounts/{accountId}/patients/{Guid.NewGuid()}/link-invites", null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("link.not_authorized", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A Patient account has no patient records of its own to invite into -- same not_authorized code as the unverified-professional case.</summary>
    [Fact]
    public async Task CreateInvite_ByPatientAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterPatientAsync(client, "link-invite-patient@example.com");

        var response = await client.PostAsync($"/accounts/{accountId}/patients/{Guid.NewGuid()}/link-invites", null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("link.not_authorized", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task CreateInvite_WithTokenForDifferentAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterActiveProfessionalAsync(client, "link-invite-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterActiveProfessionalAsync(otherClient, "link-invite-wrong-owner-target@example.com");

        var response = await client.PostAsync($"/accounts/{otherAccountId}/patients/{Guid.NewGuid()}/link-invites", null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task CreateInvite_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsync($"/accounts/{Guid.NewGuid()}/patients/{Guid.NewGuid()}/link-invites", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task CreateInvite_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.PostAsync($"/accounts/{accountId}/patients/{Guid.NewGuid()}/link-invites", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Redeem_WithEmptyCode_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var patientAccountId = await RegisterPatientAsync(client, "link-redeem-empty@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{patientAccountId}/links",
            new RedeemLinkRequest(""),
            PatientLinksJsonContext.Default.RedeemLinkRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("code", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task Redeem_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/links",
            new RedeemLinkRequest("SOMECODE1234"),
            PatientLinksJsonContext.Default.RedeemLinkRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Redeem_WithTokenForDifferentAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterPatientAsync(client, "link-redeem-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterPatientAsync(otherClient, "link-redeem-wrong-owner-target@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{otherAccountId}/links",
            new RedeemLinkRequest("SOMECODE1234"),
            PatientLinksJsonContext.Default.RedeemLinkRequest);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>A Professional redeeming (instead of a Patient) is 403 -- same not_authorized code as the invite-side guard.</summary>
    [Fact]
    public async Task Redeem_ByProfessionalAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var professionalId = await RegisterActiveProfessionalAsync(client, "link-redeem-professional@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{professionalId}/links",
            new RedeemLinkRequest("SOMECODE1234"),
            PatientLinksJsonContext.Default.RedeemLinkRequest);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("link.not_authorized", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Redeem_WithUnknownCode_Returns404WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var patientAccountId = await RegisterPatientAsync(client, "link-redeem-unknown@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{patientAccountId}/links",
            new RedeemLinkRequest("UNKNOWNCODE1"),
            PatientLinksJsonContext.Default.RedeemLinkRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("link.invite_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Redeem_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/links",
            new RedeemLinkRequest("SOMECODE1234"),
            PatientLinksJsonContext.Default.RedeemLinkRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Redeem_WhenAlreadyLinked_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var professionalClient = factory.CreateClient();
        var professionalId = await RegisterActiveProfessionalAsync(professionalClient, "link-conflict-professional@example.com");

        using var patientClient = factory.CreateClient();
        var patientAccountId = await RegisterPatientAsync(patientClient, "link-conflict-patient@example.com");

        var patientId = Guid.NewGuid();
        var firstInvite = await CreateInviteAsync(professionalClient, professionalId, patientId);
        await patientClient.PostAsJsonAsync(
            $"/accounts/{patientAccountId}/links",
            new RedeemLinkRequest(firstInvite.Code),
            PatientLinksJsonContext.Default.RedeemLinkRequest);

        var secondInvite = await CreateInviteAsync(professionalClient, professionalId, Guid.NewGuid());
        var response = await patientClient.PostAsJsonAsync(
            $"/accounts/{patientAccountId}/links",
            new RedeemLinkRequest(secondInvite.Code),
            PatientLinksJsonContext.Default.RedeemLinkRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("link.already_linked", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task GetLinks_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/accounts/{Guid.NewGuid()}/links");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GetLinks_WithTokenForDifferentAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterPatientAsync(client, "link-get-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterPatientAsync(otherClient, "link-get-wrong-owner-target@example.com");

        var response = await client.GetAsync($"/accounts/{otherAccountId}/links");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task GetLinks_WithNoLinks_ReturnsEmptyArray()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterPatientAsync(client, "link-get-empty@example.com");

        var links = await GetLinksAsync(client, accountId);

        Assert.Empty(links);
    }

    [Fact]
    public async Task Delete_ThenList_PeerKeyGone()
    {
        using var factory = CreateFactory();
        using var professionalClient = factory.CreateClient();
        var professionalId = await RegisterActiveProfessionalAsync(professionalClient, "link-delete-professional@example.com");

        using var patientClient = factory.CreateClient();
        var patientAccountId = await RegisterPatientAsync(patientClient, "link-delete-patient@example.com");

        var invite = await CreateInviteAsync(professionalClient, professionalId, Guid.NewGuid());
        await patientClient.PostAsJsonAsync(
            $"/accounts/{patientAccountId}/links",
            new RedeemLinkRequest(invite.Code),
            PatientLinksJsonContext.Default.RedeemLinkRequest);

        var deleteResponse = await patientClient.DeleteAsync($"/accounts/{patientAccountId}/links/{professionalId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        Assert.Empty(await GetLinksAsync(patientClient, patientAccountId));
        Assert.Empty(await GetLinksAsync(professionalClient, professionalId));

        // 404 repeated -- unlinking an already-gone link is not a silent no-op 204.
        var secondDeleteResponse = await patientClient.DeleteAsync($"/accounts/{patientAccountId}/links/{professionalId}");
        Assert.Equal(HttpStatusCode.NotFound, secondDeleteResponse.StatusCode);
        var body = await secondDeleteResponse.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("link.not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Delete_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.DeleteAsync($"/accounts/{Guid.NewGuid()}/links/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Delete_WithTokenForDifferentAccount_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterPatientAsync(client, "link-delete-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterPatientAsync(otherClient, "link-delete-wrong-owner-target@example.com");

        var response = await client.DeleteAsync($"/accounts/{otherAccountId}/links/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private static async Task<CreateLinkInviteResponse> CreateInviteAsync(HttpClient professionalClient, Guid professionalId, Guid patientId)
    {
        var response = await professionalClient.PostAsync($"/accounts/{professionalId}/patients/{patientId}/link-invites", null);
        var invite = await response.Content.ReadFromJsonAsync(PatientLinksJsonContext.Default.CreateLinkInviteResponse);
        return invite!;
    }

    private static async Task<IReadOnlyList<LinkView>> GetLinksAsync(HttpClient client, Guid accountId)
    {
        var response = await client.GetAsync($"/accounts/{accountId}/links");
        var links = await response.Content.ReadFromJsonAsync(PatientLinksJsonContext.Default.IReadOnlyListLinkView);
        return links!;
    }

    private static async Task PublishKeyPairAsync(HttpClient client, Guid accountId, byte fill)
    {
        await client.PutAsJsonAsync(
            $"/accounts/{accountId}/key-pair",
            new AccountKeyPairRequest(SomePublicKey(fill), SomeSealedBlob(0xC1), SomeSealedBlob(0xC2)),
            AccountsJsonContext.Default.AccountKeyPairRequest);
    }

    private static byte[] SomePublicKey(byte fill)
    {
        var key = new byte[32];
        Array.Fill(key, fill);
        return key;
    }

    private static byte[] SomeSealedBlob(byte fill)
    {
        var blob = new byte[28];
        Array.Fill(blob, fill);
        return blob;
    }

    /// <summary>Registers a Professional, completes TOTP enrollment (2FA is mandatory for Professional, ADR-S02-03) to get a real access token, then submits a verified CRP credential so AccountVerificationStatus becomes Active.</summary>
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

    /// <summary>A Patient owes no 2FA (ADR-S02-03): register alone returns a usable access token.</summary>
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

    private sealed class StubCouncilRegistryVerifier : ICouncilRegistryVerifier
    {
        public Task<CouncilRegistryVerificationResult> VerifyAsync(
            ProfessionalCredentialType type, string registryNumber, string registryUf, CancellationToken cancellationToken) =>
            Task.FromResult(CouncilRegistryVerificationResult.CreateVerified());
    }

    private sealed class AlwaysValidSessionTokenIssuer : ISessionTokenIssuer
    {
        public SessionTokenPair IssuePair(Guid accountId) => throw new NotSupportedException("not needed by the tests that use this stub");

        public RefreshSessionResult Refresh(string refreshToken) => throw new NotSupportedException("not needed by the tests that use this stub");

        public Guid? ValidateAccess(string accessToken) => Guid.TryParse(accessToken, out var accountId) ? accountId : null;
    }
}
