using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Accounts;
using Api.Endpoints;
using Api.Serialization;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests.Auth;

/// <summary>
/// Security-review fix: <c>GET .../queue</c> and <c>POST .../decision</c> are staff-only
/// (see <see cref="ProfessionalVerificationEndpoints"/>'s own doc comment) and now require
/// the <c>X-Staff-Api-Key</c> header to match <see cref="TestStaffApiKey"/>, configured for
/// this test host the same way <c>ConnectionStrings:AppDb</c> already is. Every test that
/// reaches those two endpoints attaches the header via <see cref="WithStaffApiKey"/>;
/// <see cref="PostDecision_WithoutStaffApiKey_Returns401WithProblemDetails"/> and
/// <see cref="GetQueue_WithoutStaffApiKey_Returns401WithProblemDetails"/> are the regression
/// tests proving the gate itself (no header, and a wrong key).
/// </summary>
public sealed class ProfessionalVerificationEndpointsTests
{
    private const string TestStaffApiKey = "test-staff-api-key";

    /// <summary>Fixed code the stub TOTP provider always treats as valid -- same override pattern TwoFactorEndpointsTests uses.</summary>
    private const string ValidStubCode = "111111";

    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    [Fact]
    public async Task PostSubmit_WithVerifiedCrp_Returns200WithActiveStatus()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "crp-ok@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crp, "06/123456", "SP", null),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.SubmitProfessionalCredentialResponse);
        Assert.NotNull(body);
        Assert.Equal(AccountVerificationStatus.Active, body!.Status);
        Assert.Null(body.RejectionReason);
    }

    [Fact]
    public async Task PostSubmit_WithRejectedCrm_Returns200WithRejectedStatus_AndReadableReason()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: false, failureReason: "Número não encontrado."));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "crm-rejected@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crm, "123456-SP", "SP", null),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.SubmitProfessionalCredentialResponse);
        Assert.NotNull(body);
        Assert.Equal(AccountVerificationStatus.Rejected, body!.Status);
        Assert.Equal("Número não encontrado.", body.RejectionReason);
    }

    [Fact]
    public async Task PostSubmit_WithDocument_Returns200WithInReviewStatus_AndDeclaredSla()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "doc-review@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Document, null, null, "doc-ref-1"),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.SubmitProfessionalCredentialResponse);
        Assert.NotNull(body);
        Assert.Equal(AccountVerificationStatus.InReview, body!.Status);
        Assert.Equal(AccountService.DocumentReviewSlaBusinessDays, body.DocumentReviewSlaBusinessDays);
    }

    [Fact]
    public async Task PostSubmit_WithCrpMissingRegistryNumber_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "missing-number@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crp, null, "SP", null),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("registryNumber", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostSubmit_WithCrpMissingRegistryUf_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "missing-uf@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crp, "06/123456", null, null),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("registryUf", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostSubmit_WithDocumentMissingReference_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "missing-doc-ref@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Document, null, null, null),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("documentReference", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostDecision_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        AddStaffApiKey(client);

        var response = await client.PostAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/professional-verification/decision",
            new ProfessionalVerificationDecisionRequest(Approved: true, RejectionReason: null),
            ApiJsonSerializerContext.Default.ProfessionalVerificationDecisionRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>
    /// Security-review fix side effect: a caller can no longer reach this endpoint's
    /// AccountService-level 404 without a valid access token, and a real access token can
    /// only ever resolve to an account that actually exists -- "unknown account" is
    /// therefore unreachable through a properly-scoped credential. Uses the same
    /// bypass-stub pattern <c>TwoFactorEndpointsTests</c> uses for its analogous
    /// "unknown accountId still returns 404" case: <see cref="AlwaysValidSessionTokenIssuer"/>
    /// accepts any GUID-shaped bearer token as proof for that exact account, so this test
    /// can still exercise the downstream 404 mapping in isolation.
    /// </summary>
    [Fact]
    public async Task PostSubmit_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var unknownAccountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", unknownAccountId.ToString());

        var response = await client.PostAsJsonAsync(
            $"/accounts/{unknownAccountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crp, "06/123456", "SP", null),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostSubmit_WithPatientAccount_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("patient-submits@example.com", SomeVerifier, AccountRole.Patient),
            ApiJsonSerializerContext.Default.RegisterRequest);
        var registered = await registerResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);
        // A Patient's TwoFactorRequirement is always NotApplicable (ADR-S02-03), so
        // register already returned a real session -- no TOTP flow to complete first.
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", registered!.AccessToken);

        var response = await client.PostAsJsonAsync(
            $"/accounts/{registered.Id}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crp, "06/123456", "SP", null),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.not_a_professional_account", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>
    /// Security-review regression: without a valid access token bound to this exact
    /// account, a caller who merely knows (or guesses) another professional's account id
    /// must not be able to submit a credential on their behalf.
    /// </summary>
    [Fact]
    public async Task PostSubmit_WithoutAccessToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "submit-no-token@example.com");
        client.DefaultRequestHeaders.Authorization = null;

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crp, "06/123456", "SP", null),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Core account-scoping regression: a real, valid, unexpired access token for a DIFFERENT account must not authorize this call.</summary>
    [Fact]
    public async Task PostSubmit_WithAccessTokenForAnotherAccount_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var victimAccountId = await RegisterProfessionalAsync(client, "submit-victim@example.com");
        // RegisterProfessionalAsync's side effect leaves the client carrying THIS account's
        // own real, valid access token -- registering the attacker last means the client now
        // carries the attacker's token, not the victim's.
        await RegisterProfessionalAsync(client, "submit-attacker@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{victimAccountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Document, null, null, "forged-doc-ref"),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostSubmit_WhenAlreadyActive_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "already-active@example.com");
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crp, "06/123456", "SP", null),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crp, "06/123456", "SP", null),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.invalid_verification_state", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task GetQueue_AfterDocumentSubmission_ListsThatAccount()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "queue-entry@example.com");
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Document, null, null, "doc-ref-2"),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        AddStaffApiKey(client);
        var response = await client.GetAsync("/accounts/professional-verification/queue");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        var entries = doc.RootElement.EnumerateArray().ToList();
        Assert.Contains(entries, entry => entry.GetProperty("accountId").GetGuid() == accountId);
    }

    [Fact]
    public async Task PostDecision_WithApproved_Returns200WithActiveStatus()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "decide-approve@example.com");
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Document, null, null, "doc-ref-3"),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        AddStaffApiKey(client);
        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification/decision",
            new ProfessionalVerificationDecisionRequest(Approved: true, RejectionReason: null),
            ApiJsonSerializerContext.Default.ProfessionalVerificationDecisionRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.ProfessionalVerificationDecisionResponse);
        Assert.NotNull(body);
        Assert.Equal(AccountVerificationStatus.Active, body!.Status);
    }

    [Fact]
    public async Task PostDecision_WithRejectedAndNoReason_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "decide-missing-reason@example.com");
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Document, null, null, "doc-ref-4"),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        AddStaffApiKey(client);
        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification/decision",
            new ProfessionalVerificationDecisionRequest(Approved: false, RejectionReason: null),
            ApiJsonSerializerContext.Default.ProfessionalVerificationDecisionRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("rejectionReason", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostDecision_WhenNotInReview_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "not-in-review@example.com");

        AddStaffApiKey(client);
        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification/decision",
            new ProfessionalVerificationDecisionRequest(Approved: true, RejectionReason: null),
            ApiJsonSerializerContext.Default.ProfessionalVerificationDecisionRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.not_in_review", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>
    /// Security-review regression: without a valid X-Staff-Api-Key, a professional could
    /// approve their own document review by calling this endpoint on their own account
    /// (self-approval). Covers both "no header" and "wrong key".
    /// </summary>
    [Fact]
    public async Task PostDecision_WithoutStaffApiKey_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory(new StubCouncilRegistryVerifier(verified: true));
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "self-approve@example.com");
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Document, null, null, "doc-ref-self-approve"),
            ApiJsonSerializerContext.Default.SubmitProfessionalCredentialRequest);

        var withoutHeaderResponse = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification/decision",
            new ProfessionalVerificationDecisionRequest(Approved: true, RejectionReason: null),
            ApiJsonSerializerContext.Default.ProfessionalVerificationDecisionRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, withoutHeaderResponse.StatusCode);
        var withoutHeaderBody = await withoutHeaderResponse.Content.ReadAsStringAsync();
        using var withoutHeaderDoc = JsonDocument.Parse(withoutHeaderBody);
        Assert.Equal("staff.unauthorized", withoutHeaderDoc.RootElement.GetProperty("code").GetString());

        client.DefaultRequestHeaders.Add("X-Staff-Api-Key", "wrong-key");
        var wrongKeyResponse = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification/decision",
            new ProfessionalVerificationDecisionRequest(Approved: true, RejectionReason: null),
            ApiJsonSerializerContext.Default.ProfessionalVerificationDecisionRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, wrongKeyResponse.StatusCode);
        var wrongKeyBody = await wrongKeyResponse.Content.ReadAsStringAsync();
        using var wrongKeyDoc = JsonDocument.Parse(wrongKeyBody);
        Assert.Equal("staff.unauthorized", wrongKeyDoc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task GetQueue_WithoutStaffApiKey_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var withoutHeaderResponse = await client.GetAsync("/accounts/professional-verification/queue");

        Assert.Equal(HttpStatusCode.Unauthorized, withoutHeaderResponse.StatusCode);
        var withoutHeaderBody = await withoutHeaderResponse.Content.ReadAsStringAsync();
        using var withoutHeaderDoc = JsonDocument.Parse(withoutHeaderBody);
        Assert.Equal("staff.unauthorized", withoutHeaderDoc.RootElement.GetProperty("code").GetString());

        client.DefaultRequestHeaders.Add("X-Staff-Api-Key", "wrong-key");
        var wrongKeyResponse = await client.GetAsync("/accounts/professional-verification/queue");

        Assert.Equal(HttpStatusCode.Unauthorized, wrongKeyResponse.StatusCode);
        var wrongKeyBody = await wrongKeyResponse.Content.ReadAsStringAsync();
        using var wrongKeyDoc = JsonDocument.Parse(wrongKeyBody);
        Assert.Equal("staff.unauthorized", wrongKeyDoc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>
    /// Registers a fresh Professional account AND completes its mandatory TOTP enrollment
    /// (ADR-S02-03) -- a Professional never gets a session at register time (2FA is always
    /// pending first), so a real access token for it only exists once enrollment confirms.
    /// Side effect: leaves <paramref name="client"/> carrying THIS account's real access
    /// token as its default <c>Authorization: Bearer</c> header, exactly like a real client
    /// would after completing login -- every existing caller of this helper that goes on to
    /// call <c>POST .../professional-verification</c> on the SAME client keeps working
    /// unchanged (security-review fix: that endpoint now requires it).
    /// </summary>
    private static async Task<Guid> RegisterProfessionalAsync(HttpClient client, string email)
    {
        var registerResponse = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest(email, SomeVerifier, AccountRole.Professional),
            ApiJsonSerializerContext.Default.RegisterRequest);
        var registered = await registerResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);
        var accountId = registered!.Id;
        var ticket = registered.TwoFactorTicket!;

        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/totp",
            new BeginTotpEnrollmentRequest(ticket),
            ApiJsonSerializerContext.Default.BeginTotpEnrollmentRequest);
        var confirmResponse = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/totp/confirm",
            new ConfirmTotpEnrollmentRequest(ticket, ValidStubCode),
            ApiJsonSerializerContext.Default.ConfirmTotpEnrollmentRequest);
        var confirmed = await confirmResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.ConfirmTotpEnrollmentResponse);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", confirmed!.AccessToken);
        return accountId;
    }

    private static WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                // Same reasoning as AuthEndpointsTests.CreateFactory: these endpoints never
                // touch Postgres, but app startup still needs a syntactically valid
                // ConnectionStrings:AppDb to construct the NpgsqlDataSource singleton.
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
                builder.UseSetting("StaffAccess:ApiKey", TestStaffApiKey);
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
                // TOTP itself is already covered by Api.Tests/Accounts/TotpProviderTests --
                // these tests only need a deterministic code (ValidStubCode) to drive
                // RegisterProfessionalAsync's real begin/confirm flow over HTTP, same
                // override pattern as TwoFactorEndpointsTests.
                builder.ConfigureTestServices(services => services.AddSingleton<ITotpProvider>(new StubTotpProvider()));
            });

    /// <summary>
    /// For the one test that needs to reach the AccountService-level 404 for an account
    /// that doesn't exist -- a real access token can never do that (it only ever resolves
    /// to an account <see cref="Api.Accounts.SessionTokenIssuer"/> actually issued it for),
    /// so this swaps in a stub that treats any GUID-shaped bearer token as proof for that
    /// exact account. Same bypass-for-an-unreachable-downstream-case pattern as
    /// TwoFactorEndpointsTests.CreateFactoryWithTicketBypass.
    /// </summary>
    private static WebApplicationFactory<Program> CreateFactoryWithSessionBypass(ICouncilRegistryVerifier councilRegistryVerifier) =>
        CreateFactory(councilRegistryVerifier).WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<ISessionTokenIssuer>(new AlwaysValidSessionTokenIssuer())));

    /// <summary>Attaches the correct staff API key so a test can reach the staff-only handlers.</summary>
    private static void AddStaffApiKey(HttpClient client) =>
        client.DefaultRequestHeaders.Add("X-Staff-Api-Key", TestStaffApiKey);

    /// <summary>
    /// Real CRP/CRM verification is out of scope for S02-02 (see CouncilRegistryVerifier's
    /// own TODO) -- every test that reaches the CRP/CRM submission path overrides the
    /// production ICouncilRegistryVerifier registration with this fake.
    /// </summary>
    private static WebApplicationFactory<Program> CreateFactory(ICouncilRegistryVerifier councilRegistryVerifier) =>
        CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
                services.AddSingleton(councilRegistryVerifier)));

    private sealed class StubCouncilRegistryVerifier : ICouncilRegistryVerifier
    {
        private readonly bool _verified;
        private readonly string? _failureReason;

        public StubCouncilRegistryVerifier(bool verified, string? failureReason = null)
        {
            _verified = verified;
            _failureReason = failureReason;
        }

        public Task<CouncilRegistryVerificationResult> VerifyAsync(
            ProfessionalCredentialType type, string registryNumber, string registryUf, CancellationToken cancellationToken) =>
            Task.FromResult(_verified
                ? CouncilRegistryVerificationResult.CreateVerified()
                : CouncilRegistryVerificationResult.NotVerified(_failureReason ?? "Registro não encontrado."));
    }

    private sealed class StubTotpProvider : ITotpProvider
    {
        public string GenerateSecret() => "STUBBEDSECRET";

        public string BuildProvisioningUri(string secret, string accountEmail, string issuer) =>
            $"otpauth://totp/{issuer}:{accountEmail}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30";

        public bool ValidateCode(string secret, string code, DateTimeOffset timestamp) => code == ValidStubCode;
    }

    /// <summary>See <see cref="CreateFactoryWithSessionBypass"/>.</summary>
    private sealed class AlwaysValidSessionTokenIssuer : ISessionTokenIssuer
    {
        public SessionTokenPair IssuePair(Guid accountId) => throw new NotSupportedException("not needed by the one test that uses this stub");

        public RefreshSessionResult Refresh(string refreshToken) => throw new NotSupportedException("not needed by the one test that uses this stub");

        public Guid? ValidateAccess(string accessToken) => Guid.TryParse(accessToken, out var accountId) ? accountId : null;
    }

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountService.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }
}
