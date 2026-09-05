using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api.Accounts;
using Api.Notes;
using Api.Serialization;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.Notes;

/// <summary>
/// HTTP-layer round-trip against a real Postgres (Testcontainers) -- proves the sign/read
/// contract: 201 + Location on first signature, 409 notes.already_signed on a second attempt
/// for the same note, 401 for a missing/wrong-owner token, 400 for a too-short signature blob
/// or a negative revision, and the GET half of the lock (200 when signed, 404 when not).
/// </summary>
[Collection("Database")]
public sealed class NoteEndpointsTests : IAsyncLifetime
{
    private const string TestStaffApiKey = "test-staff-api-key";
    private const string ValidStubCode = "111111";
    private const string PlaintextMarker = "THIS-IS-SIGNATURE-PLAINTEXT-MARKER";

    // Same AES-256-GCM wire-format floor as PatientEndpointsTests: iv(12) || ct || tag(16).
    private const int GcmIvLength = 12;
    private const int GcmTagLength = 16;

    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public NoteEndpointsTests(PostgresContainerFixture fixture)
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
    public async Task PostNoteSignature_ReturnsCreated_WithLocationAndNoPlaintextInBody()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "note-sign-create@example.com");
        var noteId = Guid.NewGuid();

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/notes/{noteId}/signature",
            new SignNoteRequest(1, SomeSealedSignature(PlaintextMarker)),
            NotesJsonContext.Default.SignNoteRequest);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(response.Headers.Location);
        Assert.Contains($"/accounts/{accountId}/notes/{noteId}/signature", response.Headers.Location!.ToString());

        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(PlaintextMarker, body);

        var signed = await response.Content.ReadFromJsonAsync(NotesJsonContext.Default.SignNoteResponse);
        Assert.NotNull(signed);
        Assert.Equal(noteId, signed!.NoteId);
        Assert.Equal(1, signed.Revision);
    }

    [Fact]
    public async Task PostNoteSignature_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/notes/{Guid.NewGuid()}/signature",
            new SignNoteRequest(0, SomeSealedSignature()),
            NotesJsonContext.Default.SignNoteRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A real, valid bearer token -- just for a different account than the one in the route -- must not authorize. Same wrong-owner shape as PatientEndpointsTests.PostPatient_WithValidTokenForDifferentAccount_Returns401WithProblemDetails.</summary>
    [Fact]
    public async Task PostNoteSignature_WithValidTokenForDifferentAccount_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterActiveProfessionalAsync(client, "note-sign-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterProfessionalWithoutVerificationAsync(otherClient, "note-sign-wrong-owner-target@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{otherAccountId}/notes/{Guid.NewGuid()}/signature",
            new SignNoteRequest(0, SomeSealedSignature()),
            NotesJsonContext.Default.SignNoteRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Boundary validation rejects a signature shorter than AES-256-GCM's iv(12)+tag(16) floor before it ever reaches the store -- a blob that short could never have come from a real seal operation.</summary>
    [Fact]
    public async Task PostNoteSignature_WithTooShortSignature_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "note-sign-short@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/notes/{Guid.NewGuid()}/signature",
            new SignNoteRequest(0, [0xAA]),
            NotesJsonContext.Default.SignNoteRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("signature", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>A negative revision is rejected before ever reaching NoteService -- there is no such thing as revision -1.</summary>
    [Fact]
    public async Task PostNoteSignature_WithNegativeRevision_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "note-sign-negative-revision@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/notes/{Guid.NewGuid()}/signature",
            new SignNoteRequest(-1, SomeSealedSignature()),
            NotesJsonContext.Default.SignNoteRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("revision", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostNoteSignature_ForAlreadySignedNote_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "note-sign-conflict@example.com");
        var noteId = Guid.NewGuid();
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/notes/{noteId}/signature",
            new SignNoteRequest(0, SomeSealedSignature()),
            NotesJsonContext.Default.SignNoteRequest);

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/notes/{noteId}/signature",
            new SignNoteRequest(0, SomeSealedSignature()),
            NotesJsonContext.Default.SignNoteRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("notes.already_signed", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A real access token can never resolve to an unknown account (Accounts is in-memory and session tokens are only ever issued for accounts that exist in it), so this swaps in a stub that treats any GUID-shaped bearer token as proof for that exact account, reaching NoteService.SignAsync's AccountNotFound branch in isolation -- same technique as PatientEndpointsTests.CreateFactoryWithSessionBypass.</summary>
    [Fact]
    public async Task PostNoteSignature_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/notes/{Guid.NewGuid()}/signature",
            new SignNoteRequest(0, SomeSealedSignature()),
            NotesJsonContext.Default.SignNoteRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A Professional who has not yet been verified (AccountVerificationStatus.Pending) is not authorized to sign notes -- same guard as Patients, reached here through NoteService.SignAsync's NotAuthorizedToCreateRecords branch.</summary>
    [Fact]
    public async Task PostNoteSignature_WithUnverifiedProfessional_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalWithoutVerificationAsync(client, "note-sign-unverified@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/notes/{Guid.NewGuid()}/signature",
            new SignNoteRequest(0, SomeSealedSignature()),
            NotesJsonContext.Default.SignNoteRequest);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("notes.not_authorized_to_sign", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task GetNoteSignature_ForSignedNote_Returns200WithSignature()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "note-get-signed@example.com");
        var noteId = Guid.NewGuid();
        var signatureBytes = SomeSealedSignature();
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/notes/{noteId}/signature",
            new SignNoteRequest(2, signatureBytes),
            NotesJsonContext.Default.SignNoteRequest);

        var response = await client.GetAsync($"/accounts/{accountId}/notes/{noteId}/signature");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var signature = await response.Content.ReadFromJsonAsync(NotesJsonContext.Default.NoteSignatureResponse);
        Assert.NotNull(signature);
        Assert.Equal(noteId, signature!.NoteId);
        Assert.Equal(2, signature.Revision);
        Assert.Equal(signatureBytes, signature.Signature);
    }

    [Fact]
    public async Task GetNoteSignature_ForUnsignedNote_Returns404WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "note-get-unsigned@example.com");

        var response = await client.GetAsync($"/accounts/{accountId}/notes/{Guid.NewGuid()}/signature");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("notes.signature_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Same auth guard as the POST route -- its own call site inside HandleGetAsync, its own test, mirroring PatientEndpointsTests.GetPatient_WithoutBearerToken_Returns401WithProblemDetails.</summary>
    [Fact]
    public async Task GetNoteSignature_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/accounts/{Guid.NewGuid()}/notes/{Guid.NewGuid()}/signature");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
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

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountVerifierLengths.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }

    /// <summary>A structurally valid (60-byte, iv(12)||ct(32)||tag(16)) opaque signature blob for tests that don't need real decryptable content, only a shape the boundary validation accepts. Optionally embeds a marker in the "ciphertext" span to prove the server never echoes it back.</summary>
    private static byte[] SomeSealedSignature(string? marker = null)
    {
        var blob = new byte[GcmIvLength + 32 + GcmTagLength];
        Array.Fill(blob, (byte)0xAA);
        if (marker is not null)
        {
            var markerBytes = Encoding.UTF8.GetBytes(marker);
            markerBytes.AsSpan(0, Math.Min(markerBytes.Length, 32)).CopyTo(blob.AsSpan(GcmIvLength));
        }

        return blob;
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

    // Duplicated from PatientEndpointsTests.CreateFactoryWithSessionBypass/AlwaysValidSessionTokenIssuer
    // rather than extracted: CreateFactory() itself is already duplicated per test file in this
    // suite (see above), so sharing just this one piece would split one pattern across two
    // places instead of leaving it whole in each. ~10 lines beats a new shared-infrastructure
    // file plus touching PatientEndpointsTests.cs to route through it.
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
