using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Api.Accounts;
using Api.Consent;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.Consent;

/// <summary>
/// HTTP-layer round-trip against a real Postgres (Testcontainers) -- proves the record/read
/// contract: 201 on a recorded decision, 400 for an unknown purpose or decision string, 401 for
/// a missing/wrong-owner token, 403 for an unverified Professional, 404 for an unknown account,
/// and the GET half reporting the fold of both purposes (Pendente with no events, Concedido or
/// Revogado from the most recent event for that purpose).
/// </summary>
[Collection("Database")]
public sealed class ConsentEndpointsTests : IAsyncLifetime
{
    private const string TestStaffApiKey = "test-staff-api-key";
    private const string ValidStubCode = "111111";

    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    // ConsentJsonContext.Default's own baked-in options know nothing about the enum-as-string
    // converter -- the server only sees it because ConsentComposition.AddConsent adds it at
    // the JsonSerializerOptions level, not by decorating ConsentStatus itself. Mirroring that
    // one line here (rather than exposing the server's private converter field just for this)
    // is what lets this options instance read the same "pendente"/"concedido"/"revogado"
    // strings the server actually sends, instead of only the numeric fallback
    // JsonStringEnumConverter also accepts on read.
    private static readonly JsonSerializerOptions ConsentResponseJsonOptions = CreateConsentResponseJsonOptions();

    private static JsonSerializerOptions CreateConsentResponseJsonOptions()
    {
        var options = new JsonSerializerOptions(ConsentJsonContext.Default.Options);
        options.Converters.Add(new JsonStringEnumConverter<ConsentStatus>(JsonNamingPolicy.CamelCase));
        return options;
    }

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public ConsentEndpointsTests(PostgresContainerFixture fixture)
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

    [Fact]
    public async Task GetConsents_AfterRevokingRecording_ReportsRevogado()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "consent-revoke@example.com");
        var patientId = Guid.NewGuid();

        await PostConsentAsync(client, accountId, patientId, "gravacao", "concedido");
        await PostConsentAsync(client, accountId, patientId, "gravacao", "revogado");

        var response = await client.GetAsync($"/accounts/{accountId}/patients/{patientId}/consents");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal("""{"gravacao":"revogado","analiseIa":"pendente"}""", body);
        var snapshot = await response.Content.ReadFromJsonAsync<ConsentSnapshot>(ConsentResponseJsonOptions);
        Assert.NotNull(snapshot);
        Assert.Equal(ConsentStatus.Revogado, snapshot!.Gravacao);
        Assert.Equal(ConsentStatus.Pendente, snapshot.AnaliseIa);
    }

    [Fact]
    public async Task GetConsents_AfterGrantingRecordingOnly_ReportsGravacaoConcedidaEAnaliseIaPendente()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "consent-grant-only@example.com");
        var patientId = Guid.NewGuid();

        var postResponse = await PostConsentAsync(client, accountId, patientId, "gravacao", "concedido");
        Assert.Equal(HttpStatusCode.Created, postResponse.StatusCode);
        var recorded = await postResponse.Content.ReadFromJsonAsync(ConsentJsonContext.Default.RecordConsentResponse);
        Assert.NotNull(recorded);
        Assert.Equal(patientId, recorded!.PatientId);
        Assert.Equal("gravacao", recorded.Purpose);
        Assert.Equal("concedido", recorded.Decision);

        var response = await client.GetAsync($"/accounts/{accountId}/patients/{patientId}/consents");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var snapshot = await response.Content.ReadFromJsonAsync<ConsentSnapshot>(ConsentResponseJsonOptions);
        Assert.NotNull(snapshot);
        Assert.Equal(ConsentStatus.Concedido, snapshot!.Gravacao);
        Assert.Equal(ConsentStatus.Pendente, snapshot.AnaliseIa);
    }

    /// <summary>Same guard as PostNoteSignature_WithUnverifiedProfessional_Returns403WithProblemDetails, reached here through ConsentService.RecordAsync's NotAuthorizedToCreateRecords branch.</summary>
    [Fact]
    public async Task PostConsent_WithUnverifiedProfessional_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalWithoutVerificationAsync(client, "consent-unverified@example.com");

        var response = await PostConsentAsync(client, accountId, Guid.NewGuid(), "gravacao", "concedido");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("consent.not_authorized_to_record", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostConsent_WithUnknownPurpose_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "consent-unknown-purpose@example.com");

        var response = await PostConsentAsync(client, accountId, Guid.NewGuid(), "nao-existe", "concedido");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("purpose", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>Same 400 shape as an unknown purpose, but the decision branch -- its own call site inside HandleRecordAsync, needs its own test for full branch coverage.</summary>
    [Fact]
    public async Task PostConsent_WithUnknownDecision_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "consent-unknown-decision@example.com");

        var response = await PostConsentAsync(client, accountId, Guid.NewGuid(), "gravacao", "nao-existe");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("decision", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostConsent_WithoutBearerForThisAccount_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterActiveProfessionalAsync(client, "consent-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterProfessionalWithoutVerificationAsync(otherClient, "consent-wrong-owner-target@example.com");

        var response = await PostConsentAsync(client, otherAccountId, Guid.NewGuid(), "gravacao", "concedido");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task GetConsents_WithoutBearerForThisAccount_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/accounts/{Guid.NewGuid()}/patients/{Guid.NewGuid()}/consents");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A real access token can never resolve to an unknown account, so this swaps in a stub that treats any GUID-shaped bearer token as proof for that exact account, reaching ConsentService.RecordAsync's AccountNotFound branch in isolation -- same technique as NoteEndpointsTests.PostNoteSignature_WithUnknownAccountId_Returns404WithProblemDetails.</summary>
    [Fact]
    public async Task PostConsent_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await PostConsentAsync(client, accountId, Guid.NewGuid(), "gravacao", "concedido");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    private static Task<HttpResponseMessage> PostConsentAsync(HttpClient client, Guid accountId, Guid patientId, string purpose, string decision) =>
        client.PostAsJsonAsync(
            $"/accounts/{accountId}/patients/{patientId}/consents",
            new RecordConsentRequest(purpose, decision),
            ConsentJsonContext.Default.RecordConsentRequest);

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
                builder.UseSetting("StaffAccess:ApiKey", TestStaffApiKey);
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
                builder.ConfigureTestServices(services =>
                {
                    services.AddSingleton<ITotpProvider>(new StubTotpProvider());
                    services.AddSingleton<ICouncilRegistryVerifier>(new StubCouncilRegistryVerifier());
                });
            });

    // Duplicated from NoteEndpointsTests/PatientEndpointsTests.CreateFactoryWithSessionBypass
    // rather than extracted -- same reasoning as NoteEndpointsTests: CreateFactory() itself is
    // already duplicated per test file in this suite, so sharing just this one piece would
    // split one pattern across two places instead of leaving it whole in each.
    private WebApplicationFactory<Program> CreateFactoryWithSessionBypass() =>
        CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<ISessionTokenIssuer>(new AlwaysValidSessionTokenIssuer())));

    private sealed class AlwaysValidSessionTokenIssuer : ISessionTokenIssuer
    {
        public SessionTokenPair IssuePair(Guid accountId) => throw new NotSupportedException("not needed by the one test that uses this stub");

        public RefreshSessionResult Refresh(string refreshToken) => throw new NotSupportedException("not needed by the one test that uses this stub");

        public Guid? ValidateAccess(string accessToken) => Guid.TryParse(accessToken, out var accountId) ? accountId : null;
    }

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
