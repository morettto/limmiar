using System.Buffers.Text;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Accounts;
using Api.Serialization;
using Api.Tests.Accounts;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.Auth;

/// <summary>Accounts live in Postgres (S11-03) -- real fixture + Respawn reset, same discipline as SchedulingEndpointsTests.</summary>
[Collection("Database")]
public sealed class AuthEndpointsTests : IAsyncLifetime
{
    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    [Fact]
    public async Task PostLogout_RevokesTheFamilyIncludingAccessTokens_AndIsIdempotent()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var issuer = factory.Services.GetRequiredService<ISessionTokenIssuer>();
        var accountId = Guid.NewGuid();
        var first = issuer.IssuePair(accountId);
        var current = issuer.Refresh(first.RefreshToken).TokenPair!;

        foreach (var token in new[] { first.RefreshToken, current.RefreshToken, "never-issued" })
        {
            var response = await client.PostAsJsonAsync("/auth/logout", new RefreshTokenRequest(token),
                AccountsJsonContext.Default.RefreshTokenRequest);
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
            Assert.Empty(await response.Content.ReadAsStringAsync());
        }
        var refresh = await client.PostAsJsonAsync("/auth/refresh", new RefreshTokenRequest(current.RefreshToken),
            AccountsJsonContext.Default.RefreshTokenRequest);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", current.AccessToken);
        var access = await client.GetAsync($"/accounts/{accountId}/agenda/sessions?from=2026-10-03&to=2026-10-04");
        Assert.Equal(HttpStatusCode.Unauthorized, access.StatusCode);
        Assert.Null(issuer.ValidateAccess(first.AccessToken));
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public async Task PostLogout_MissingTokenReturnsValidationProblem(string token)
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/auth/logout", new RefreshTokenRequest(token),
            AccountsJsonContext.Default.RefreshTokenRequest);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("refreshToken", body.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public AuthEndpointsTests(PostgresContainerFixture fixture)
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
    public async Task PostRegister_WithNewEmail_Returns201WithAccountBody()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("new@example.com", SomeVerifier, AccountRole.Professional),
            AccountsJsonContext.Default.RegisterRequest);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync(AccountsJsonContext.Default.RegisterResponse);
        Assert.NotNull(body);
        Assert.Equal("new@example.com", body!.Email);
        Assert.Equal(AccountRole.Professional, body.Role);
        Assert.NotEqual(Guid.Empty, body.Id);
    }

    [Fact]
    public async Task PostRegister_WithEmailAlreadyRegistered_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var request = new RegisterRequest("taken@example.com", SomeVerifier, AccountRole.Professional);
        await client.PostAsJsonAsync("/auth/register", request, AccountsJsonContext.Default.RegisterRequest);

        var response = await client.PostAsJsonAsync("/auth/register", request, AccountsJsonContext.Default.RegisterRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.email_already_registered", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal(409, doc.RootElement.GetProperty("status").GetInt32());
    }

    [Fact]
    public async Task PostRegister_WithMissingEmail_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("", SomeVerifier, AccountRole.Patient),
            AccountsJsonContext.Default.RegisterRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("email", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostRegister_WithWrongLengthVerifier_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("someone@example.com", new byte[] { 1, 2, 3 }, AccountRole.Patient),
            AccountsJsonContext.Default.RegisterRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("passwordVerifier", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostLogin_WithCorrectVerifier_Returns200WithAccountBody()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("login-ok@example.com", SomeVerifier, AccountRole.Professional),
            AccountsJsonContext.Default.RegisterRequest);

        var response = await client.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest("login-ok@example.com", SomeVerifier),
            AccountsJsonContext.Default.LoginRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(AccountsJsonContext.Default.LoginResponse);
        Assert.NotNull(body);
        Assert.Equal("login-ok@example.com", body!.Email);
        Assert.Equal(AccountRole.Professional, body.Role);
    }

    /// <summary>S02-01 AC: wrong password and unknown e-mail return byte-identical responses so a client can't distinguish the cases; AccountServiceTests proves equal computational work domain-side.</summary>
    [Fact]
    public async Task PostLogin_WithWrongPasswordAndWithUnknownEmail_ReturnIdenticalResponses()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("registered@example.com", SomeVerifier, AccountRole.Patient),
            AccountsJsonContext.Default.RegisterRequest);

        var wrongPasswordResponse = await client.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest("registered@example.com", CreateVerifier(0xFF)),
            AccountsJsonContext.Default.LoginRequest);

        var unknownEmailResponse = await client.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest("nobody-registered@example.com", SomeVerifier),
            AccountsJsonContext.Default.LoginRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPasswordResponse.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmailResponse.StatusCode);
        Assert.Equal(wrongPasswordResponse.Content.Headers.ContentType, unknownEmailResponse.Content.Headers.ContentType);

        var wrongPasswordBody = await wrongPasswordResponse.Content.ReadAsStringAsync();
        var unknownEmailBody = await unknownEmailResponse.Content.ReadAsStringAsync();
        Assert.Equal(wrongPasswordBody, unknownEmailBody);

        using var doc = JsonDocument.Parse(wrongPasswordBody);
        Assert.Equal("auth.invalid_credentials", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>A Patient owes no 2FA (ADR-S02-03), so login must return a session immediately -- the other half of PostLogin_WithCorrectVerifier_Returns200WithAccountBody's Professional/2FA-pending case.</summary>
    [Fact]
    public async Task PostLogin_WithPatientRole_RejectsPatientIdentity()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("login-patient-tokens@example.com", SomeVerifier, AccountRole.Patient),
            AccountsJsonContext.Default.RegisterRequest);

        var response = await client.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest("login-patient-tokens@example.com", SomeVerifier),
            AccountsJsonContext.Default.LoginRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task PostLogin_WithMissingEmail_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest("", SomeVerifier),
            AccountsJsonContext.Default.LoginRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("email", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>Covers "field present but null", a separate validation branch from the wrong-length-array case in PostRegister_WithWrongLengthVerifier_Returns400WithValidationProblemDetails.</summary>
    [Fact]
    public async Task PostRegister_WithNullVerifier_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        using var content = new StringContent(
            """{"email":"someone@example.com","passwordVerifier":null,"role":"professional"}""",
            System.Text.Encoding.UTF8,
            "application/json");

        var response = await client.PostAsync("/auth/register", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("passwordVerifier", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostGoogle_WithNewEmail_Returns200WithRequestedRoleAndIsNewAccountTrue()
    {
        using var factory = CreateFactory(new StubGoogleIdentityProvider(
            ("new-google-token", new GoogleIdentity("new-via-google@example.com", "google-subject-new"))));
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/google",
            new GoogleAuthRequest("new-google-token", AccountRole.Professional),
            AccountsJsonContext.Default.GoogleAuthRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(AccountsJsonContext.Default.GoogleAuthResponse);
        Assert.NotNull(body);
        Assert.Equal("new-via-google@example.com", body!.Email);
        Assert.Equal(AccountRole.Professional, body.Role);
        Assert.True(body.IsNewAccount);
    }

    /// <summary>S02-01 AC: Google resolves the account's existing role and ignores the requested one when the e-mail is already registered.</summary>
    [Fact]
    public async Task PostGoogle_WithExistingProfessional_UsesExistingAccount()
    {
        using var factory = CreateFactory(new StubGoogleIdentityProvider(
            ("existing-google-token", new GoogleIdentity("already-here@example.com", "google-subject-existing"))));
        using var client = factory.CreateClient();

        await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("already-here@example.com", SomeVerifier, AccountRole.Professional),
            AccountsJsonContext.Default.RegisterRequest);

        var response = await client.PostAsJsonAsync(
            "/auth/google",
            new GoogleAuthRequest("existing-google-token", AccountRole.Professional),
            AccountsJsonContext.Default.GoogleAuthRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(AccountsJsonContext.Default.GoogleAuthResponse);
        Assert.NotNull(body);
        Assert.Equal(AccountRole.Professional, body!.Role);
        Assert.False(body.IsNewAccount);
    }

    [Fact]
    public async Task PostGoogle_WithNewPatientEmail_RejectsPatientIdentity()
    {
        using var factory = CreateFactory(new StubGoogleIdentityProvider(
            ("new-patient-google-token", new GoogleIdentity("new-patient-via-google@example.com", "google-subject-new-patient"))));
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/google",
            new GoogleAuthRequest("new-patient-google-token", AccountRole.Patient),
            AccountsJsonContext.Default.GoogleAuthRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task PostGoogle_WithInvalidToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory(new StubGoogleIdentityProvider());
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/google",
            new GoogleAuthRequest("unrecognized-token", AccountRole.Patient),
            AccountsJsonContext.Default.GoogleAuthRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.google_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostGoogle_WithMissingIdToken_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory(new StubGoogleIdentityProvider());
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/google",
            new GoogleAuthRequest("", AccountRole.Patient),
            AccountsJsonContext.Default.GoogleAuthRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("idToken", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostRegister_WithPatientRole_RejectsPatientIdentity()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("patient-tokens@example.com", SomeVerifier, AccountRole.Patient),
            AccountsJsonContext.Default.RegisterRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostRegister_WithProfessionalRole_DoesNotReturnSessionTokens()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("pro-no-tokens@example.com", SomeVerifier, AccountRole.Professional),
            AccountsJsonContext.Default.RegisterRequest);

        var body = await response.Content.ReadFromJsonAsync(AccountsJsonContext.Default.RegisterResponse);
        Assert.Null(body!.AccessToken);
        Assert.Null(body.RefreshToken);
    }

    [Fact]
    public async Task PostRefresh_WithFreshlyIssuedRefreshToken_Returns200WithNewPair()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var issued = await AnonymousAccountFixture.CreateAsync(factory.Services);

        var response = await client.PostAsJsonAsync(
            "/auth/refresh",
            new RefreshTokenRequest(issued!.RefreshToken!),
            AccountsJsonContext.Default.RefreshTokenRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(AccountsJsonContext.Default.RefreshTokenResponse);
        Assert.NotNull(body);
        Assert.NotEqual(issued.RefreshToken, body!.RefreshToken);
        Assert.NotEqual(issued.AccessToken, body.AccessToken);
    }

    /// <summary>Notion AC: a refresh token used once is never accepted again -- proven here at the HTTP layer (SessionTokenIssuerTests covers the domain layer).</summary>
    [Fact]
    public async Task PostRefresh_WithAlreadyUsedRefreshToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var issued = await AnonymousAccountFixture.CreateAsync(factory.Services);
        await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest(issued!.RefreshToken!), AccountsJsonContext.Default.RefreshTokenRequest);

        var response = await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest(issued.RefreshToken!), AccountsJsonContext.Default.RefreshTokenRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.refresh_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Same account-enumeration discipline as PostLogin's identical-response test: "never issued" and "already used" must be indistinguishable to a caller.</summary>
    [Fact]
    public async Task PostRefresh_WithUnknownToken_ReturnsSameResponseAsReusedToken()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var issued = await AnonymousAccountFixture.CreateAsync(factory.Services);
        await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest(issued!.RefreshToken!), AccountsJsonContext.Default.RefreshTokenRequest);
        var reusedResponse = await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest(issued.RefreshToken!), AccountsJsonContext.Default.RefreshTokenRequest);

        var unknownResponse = await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest("never-issued-token"), AccountsJsonContext.Default.RefreshTokenRequest);

        Assert.Equal(reusedResponse.StatusCode, unknownResponse.StatusCode);
        Assert.Equal(await reusedResponse.Content.ReadAsStringAsync(), await unknownResponse.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task PostRefresh_WithMissingRefreshToken_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest(""), AccountsJsonContext.Default.RefreshTokenRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("refreshToken", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    private const string WebAuthnRelyingPartyId = "limmiar.test";
    private const string WebAuthnOrigin = "https://limmiar.test";

    [Fact]
    public async Task PostMagicLinkVerify_WithInvalidToken_Returns401WithMagicLinkInvalidProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/verify",
            new VerifyMagicLinkRequest("never-issued"),
            AccountsJsonContext.Default.VerifyMagicLinkRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.magic_link_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostMagicLinkVerify_WithMissingToken_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/verify",
            new VerifyMagicLinkRequest(""),
            AccountsJsonContext.Default.VerifyMagicLinkRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("token", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostMagicLinkWebAuthnComplete_WithUnknownTicket_Returns401WithCeremonyFailedProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest(
                "never-issued", Convert.ToBase64String([1]), Convert.ToBase64String([2]), Convert.ToBase64String([3]), null, null),
            AccountsJsonContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.webauthn_ceremony_failed", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostMagicLinkWebAuthnComplete_WithNonBase64CredentialId_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest(
                "some-ticket", "not-base64!!", Convert.ToBase64String([1]), null, null, null),
            AccountsJsonContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("credentialId", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostMagicLinkWebAuthnComplete_WithEmptyCredentialId_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest("some-ticket", "", Convert.ToBase64String([1]), null, null, null),
            AccountsJsonContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("credentialId", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostMagicLinkWebAuthnComplete_WithMissingMagicLinkTicket_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest("", Convert.ToBase64String([1]), Convert.ToBase64String([2]), null, null, null),
            AccountsJsonContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("magicLinkTicket", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostMagicLinkWebAuthnComplete_WithNonBase64ClientDataJson_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest(
                "some-ticket", Convert.ToBase64String([1]), "not-base64!!", null, null, null),
            AccountsJsonContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("clientDataJson", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostMagicLinkWebAuthnComplete_WithNonBase64AttestationObject_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest(
                "some-ticket", Convert.ToBase64String([1]), Convert.ToBase64String([2]), "not-base64!!", null, null),
            AccountsJsonContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("attestationObject", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostMagicLinkWebAuthnComplete_WithNonBase64AuthenticatorData_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest(
                "some-ticket", Convert.ToBase64String([1]), Convert.ToBase64String([2]), null, "not-base64!!", null),
            AccountsJsonContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("authenticatorData", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostMagicLinkWebAuthnComplete_WithNonBase64Signature_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest(
                "some-ticket", Convert.ToBase64String([1]), Convert.ToBase64String([2]), null, null, "not-base64!!"),
            AccountsJsonContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("signature", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                // Never touches Postgres, but startup still needs a syntactically valid
                // ConnectionStrings:AppDb to construct the NpgsqlDataSource singleton.
                builder.UseSetting("ConnectionStrings:AppDb", _fixture.AppRoleConnectionString);
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", WebAuthnRelyingPartyId);
                builder.UseSetting("WebAuthn:ExpectedOrigin", WebAuthnOrigin);
                builder.UseSetting("AbacatePay:WebhookSecret", "whsec_test123");
                builder.UseSetting("AbacatePay:ApiKey", "test-abacate-key");
                builder.UseSetting("Totp:EncryptionKey", TotpTestEncryptionKey.Base64);
            });

    private WebApplicationFactory<Program> CreateFactory(IGoogleIdentityProvider googleIdentityProvider) =>
        CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
                services.AddSingleton(googleIdentityProvider)));

    private sealed class StubGoogleIdentityProvider : IGoogleIdentityProvider
    {
        private readonly Dictionary<string, GoogleIdentity> _identitiesByToken;

        public StubGoogleIdentityProvider(params (string Token, GoogleIdentity Identity)[] identities)
        {
            _identitiesByToken = identities.ToDictionary(pair => pair.Token, pair => pair.Identity, StringComparer.Ordinal);
        }

        public Task<GoogleIdentity?> VerifyIdTokenAsync(string idToken, CancellationToken cancellationToken) =>
            Task.FromResult(_identitiesByToken.GetValueOrDefault(idToken));
    }

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountVerifierLengths.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }
}
