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
/// S02-06 backend: BIP39 recovery-phrase account recovery. Same split as
/// <see cref="AuthEndpointsTests"/>/<see cref="ProfessionalVerificationEndpointsTests"/> --
/// HTTP-layer coverage; <see cref="Api.Tests.Accounts.AccountServiceRecoveryTests"/> already
/// covers the domain layer.
/// </summary>
public sealed class RecoveryEndpointsTests
{
    private const string ValidStubCode = "111111";

    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);
    private static readonly byte[] SomeRecoveryVerifier = CreateVerifier(0x02);

    [Fact]
    public async Task PostAccountRecoveryPhrase_WithValidAccessToken_Returns200()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "recovery-register@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/recovery-phrase",
            new RegisterRecoveryVerifierRequest(SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RegisterRecoveryVerifierRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterRecoveryVerifierResponse);
        Assert.NotNull(body);
        Assert.Equal(accountId, body!.AccountId);
    }

    [Fact]
    public async Task PostAccountRecoveryPhrase_WithoutAccessToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "recovery-no-token@example.com");
        client.DefaultRequestHeaders.Authorization = null;

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/recovery-phrase",
            new RegisterRecoveryVerifierRequest(SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RegisterRecoveryVerifierRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostAccountRecoveryPhrase_WithInvalidAccessToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "recovery-bad-token@example.com");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "not-a-real-token");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/recovery-phrase",
            new RegisterRecoveryVerifierRequest(SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RegisterRecoveryVerifierRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Core account-scoping regression: a real, valid, unexpired access token for a DIFFERENT account must not authorize this call.</summary>
    [Fact]
    public async Task PostAccountRecoveryPhrase_WithAccessTokenForAnotherAccount_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var victimAccountId = await RegisterProfessionalAsync(client, "recovery-victim@example.com");
        // RegisterProfessionalAsync's side effect leaves the client carrying THIS account's
        // own real, valid access token -- registering the attacker last means the client now
        // carries the attacker's token, not the victim's.
        await RegisterProfessionalAsync(client, "recovery-attacker@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{victimAccountId}/recovery-phrase",
            new RegisterRecoveryVerifierRequest(SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RegisterRecoveryVerifierRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostAccountRecoveryPhrase_WithWrongLengthVerifier_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "recovery-bad-shape@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/recovery-phrase",
            new RegisterRecoveryVerifierRequest(new byte[] { 1, 2, 3 }),
            ApiJsonSerializerContext.Default.RegisterRecoveryVerifierRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("recoveryVerifier", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostAccountRecoveryPhrase_WithPatientAccount_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("recovery-patient@example.com", SomeVerifier, AccountRole.Patient),
            ApiJsonSerializerContext.Default.RegisterRequest);
        var registered = await registerResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);
        // A Patient's TwoFactorRequirement is always NotApplicable (ADR-S02-03), so
        // register already returned a real session -- no TOTP flow to complete first.
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", registered!.AccessToken);

        var response = await client.PostAsJsonAsync(
            $"/accounts/{registered.Id}/recovery-phrase",
            new RegisterRecoveryVerifierRequest(SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RegisterRecoveryVerifierRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.not_a_professional_account", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>
    /// Same bypass-for-an-unreachable-downstream-case pattern as
    /// <c>ProfessionalVerificationEndpointsTests.PostSubmit_WithUnknownAccountId_Returns404WithProblemDetails</c>:
    /// a real access token can never resolve to an account that doesn't exist, so this
    /// swaps in <see cref="AlwaysValidSessionTokenIssuer"/>, which accepts any GUID-shaped
    /// bearer token as proof for that exact account, to exercise the downstream 404 mapping
    /// in isolation.
    /// </summary>
    [Fact]
    public async Task PostAccountRecoveryPhrase_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var unknownAccountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", unknownAccountId.ToString());

        var response = await client.PostAsJsonAsync(
            $"/accounts/{unknownAccountId}/recovery-phrase",
            new RegisterRecoveryVerifierRequest(SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RegisterRecoveryVerifierRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>
    /// Covers the "field present in JSON but null" shape, distinct from the
    /// wrong-length-array case already covered by
    /// PostAccountRecoveryPhrase_WithWrongLengthVerifier_Returns400WithValidationProblemDetails
    /// -- same precedent as AuthEndpointsTests.PostRegister_WithNullVerifier_Returns400WithValidationProblemDetails.
    /// </summary>
    [Fact]
    public async Task PostAccountRecoveryPhrase_WithNullVerifier_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "recovery-null-shape@example.com");

        using var content = new StringContent(
            """{"recoveryVerifier":null}""",
            System.Text.Encoding.UTF8,
            "application/json");

        var response = await client.PostAsync($"/accounts/{accountId}/recovery-phrase", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("recoveryVerifier", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostAuthRecover_WithCorrectVerifier_Returns200WithAccountBody()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "recover-ok@example.com");
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/recovery-phrase",
            new RegisterRecoveryVerifierRequest(SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RegisterRecoveryVerifierRequest);

        var response = await client.PostAsJsonAsync(
            "/auth/recover",
            new RecoverAccessRequest("recover-ok@example.com", SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RecoverAccessRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RecoverAccessResponse);
        Assert.NotNull(body);
        Assert.Equal("recover-ok@example.com", body!.Email);
        Assert.Equal(AccountRole.Professional, body.Role);
        // 2FA is mandatory on every login for a Professional, even one that already
        // confirmed enrollment (ADR-S02-03/S02-04) -- recovery re-authenticates the account
        // but still owes a fresh TOTP challenge before a session is issued, same as
        // AccountService.LoginAsync would for this same account.
        Assert.Equal(TwoFactorRequirement.ChallengeRequired, body.TwoFactorRequirement);
        Assert.NotNull(body.TwoFactorTicket);
        Assert.Null(body.AccessToken);
        Assert.Null(body.RefreshToken);
    }

    [Fact]
    public async Task PostAuthRecover_WithWrongVerifier_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "recover-wrong@example.com");
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/recovery-phrase",
            new RegisterRecoveryVerifierRequest(SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RegisterRecoveryVerifierRequest);

        var response = await client.PostAsJsonAsync(
            "/auth/recover",
            new RecoverAccessRequest("recover-wrong@example.com", CreateVerifier(0xFF)),
            ApiJsonSerializerContext.Default.RecoverAccessRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.invalid_recovery_phrase", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostAuthRecover_WithUnknownEmail_Returns401WithSameProblemDetailsAsWrongVerifier()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "recover-compare@example.com");
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/recovery-phrase",
            new RegisterRecoveryVerifierRequest(SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RegisterRecoveryVerifierRequest);

        var wrongVerifierResponse = await client.PostAsJsonAsync(
            "/auth/recover",
            new RecoverAccessRequest("recover-compare@example.com", CreateVerifier(0xFF)),
            ApiJsonSerializerContext.Default.RecoverAccessRequest);
        var unknownEmailResponse = await client.PostAsJsonAsync(
            "/auth/recover",
            new RecoverAccessRequest("nobody-registered@example.com", SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RecoverAccessRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, wrongVerifierResponse.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmailResponse.StatusCode);
        Assert.Equal(await wrongVerifierResponse.Content.ReadAsStringAsync(), await unknownEmailResponse.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task PostAuthRecover_WithMissingEmail_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/recover",
            new RecoverAccessRequest("", SomeRecoveryVerifier),
            ApiJsonSerializerContext.Default.RecoverAccessRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("email", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostAuthRecover_WithWrongLengthVerifier_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/recover",
            new RecoverAccessRequest("someone@example.com", new byte[] { 1, 2, 3 }),
            ApiJsonSerializerContext.Default.RecoverAccessRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("recoveryVerifier", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>
    /// Covers the "field present in JSON but null" shape, distinct from the
    /// wrong-length-array case above -- same precedent as
    /// AuthEndpointsTests.PostRegister_WithNullVerifier_Returns400WithValidationProblemDetails.
    /// </summary>
    [Fact]
    public async Task PostAuthRecover_WithNullVerifier_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        using var content = new StringContent(
            """{"email":"someone@example.com","recoveryVerifier":null}""",
            System.Text.Encoding.UTF8,
            "application/json");

        var response = await client.PostAsync("/auth/recover", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("recoveryVerifier", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>
    /// Registers a fresh Professional account AND completes its mandatory TOTP enrollment
    /// (ADR-S02-03), same helper precedent as
    /// <c>ProfessionalVerificationEndpointsTests.RegisterProfessionalAsync</c>. Side effect:
    /// leaves <paramref name="client"/> carrying THIS account's real access token as its
    /// default <c>Authorization: Bearer</c> header.
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
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
                // TOTP itself is already covered by Api.Tests/Accounts/TotpProviderTests --
                // these tests only need a deterministic code to drive RegisterProfessionalAsync's
                // real begin/confirm flow over HTTP, same override pattern as
                // ProfessionalVerificationEndpointsTests.
                builder.ConfigureTestServices(services => services.AddSingleton<ITotpProvider>(new StubTotpProvider()));
            });

    /// <summary>For the one test that needs to reach the AccountService-level 404 for an account that doesn't exist. See <see cref="AlwaysValidSessionTokenIssuer"/>.</summary>
    private static WebApplicationFactory<Program> CreateFactoryWithSessionBypass() =>
        CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<ISessionTokenIssuer>(new AlwaysValidSessionTokenIssuer())));

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountService.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }

    private sealed class StubTotpProvider : ITotpProvider
    {
        public string GenerateSecret() => "STUBBEDSECRET";

        public string BuildProvisioningUri(string secret, string accountEmail, string issuer) =>
            $"otpauth://totp/{issuer}:{accountEmail}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30";

        public bool ValidateCode(string secret, string code, DateTimeOffset timestamp) => code == ValidStubCode;
    }

    /// <summary>Same bypass stub as <c>ProfessionalVerificationEndpointsTests</c>'s own copy: treats any GUID-shaped bearer token as proof for that exact account.</summary>
    private sealed class AlwaysValidSessionTokenIssuer : ISessionTokenIssuer
    {
        public SessionTokenPair IssuePair(Guid accountId) => throw new NotSupportedException("not needed by the one test that uses this stub");

        public RefreshSessionResult Refresh(string refreshToken) => throw new NotSupportedException("not needed by the one test that uses this stub");

        public Guid? ValidateAccess(string accessToken) => Guid.TryParse(accessToken, out var accountId) ? accountId : null;
    }
}
