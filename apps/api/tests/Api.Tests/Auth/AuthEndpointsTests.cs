using System.Buffers.Text;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Accounts;
using Api.Endpoints;
using Api.Serialization;
using Api.Tests.Accounts;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests.Auth;

public sealed class AuthEndpointsTests
{
    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    [Fact]
    public async Task PostRegister_WithNewEmail_Returns201WithAccountBody()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("new@example.com", SomeVerifier, AccountRole.Professional),
            ApiJsonSerializerContext.Default.RegisterRequest);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);
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

        var request = new RegisterRequest("taken@example.com", SomeVerifier, AccountRole.Patient);
        await client.PostAsJsonAsync("/auth/register", request, ApiJsonSerializerContext.Default.RegisterRequest);

        var response = await client.PostAsJsonAsync("/auth/register", request, ApiJsonSerializerContext.Default.RegisterRequest);

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
            ApiJsonSerializerContext.Default.RegisterRequest);

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
            ApiJsonSerializerContext.Default.RegisterRequest);

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
            ApiJsonSerializerContext.Default.RegisterRequest);

        var response = await client.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest("login-ok@example.com", SomeVerifier),
            ApiJsonSerializerContext.Default.LoginRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.LoginResponse);
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
            ApiJsonSerializerContext.Default.RegisterRequest);

        var wrongPasswordResponse = await client.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest("registered@example.com", CreateVerifier(0xFF)),
            ApiJsonSerializerContext.Default.LoginRequest);

        var unknownEmailResponse = await client.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest("nobody-registered@example.com", SomeVerifier),
            ApiJsonSerializerContext.Default.LoginRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPasswordResponse.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmailResponse.StatusCode);
        Assert.Equal(wrongPasswordResponse.Content.Headers.ContentType, unknownEmailResponse.Content.Headers.ContentType);

        var wrongPasswordBody = await wrongPasswordResponse.Content.ReadAsStringAsync();
        var unknownEmailBody = await unknownEmailResponse.Content.ReadAsStringAsync();
        Assert.Equal(wrongPasswordBody, unknownEmailBody);

        using var doc = JsonDocument.Parse(wrongPasswordBody);
        Assert.Equal("auth.invalid_credentials", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostLogin_WithMissingEmail_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest("", SomeVerifier),
            ApiJsonSerializerContext.Default.LoginRequest);

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
            ApiJsonSerializerContext.Default.GoogleAuthRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.GoogleAuthResponse);
        Assert.NotNull(body);
        Assert.Equal("new-via-google@example.com", body!.Email);
        Assert.Equal(AccountRole.Professional, body.Role);
        Assert.True(body.IsNewAccount);
    }

    /// <summary>S02-01 AC: Google resolves the account's existing role and ignores the requested one when the e-mail is already registered.</summary>
    [Fact]
    public async Task PostGoogle_WithEmailAlreadyRegistered_ResolvesExistingRole_IgnoringRequestedRole()
    {
        using var factory = CreateFactory(new StubGoogleIdentityProvider(
            ("existing-google-token", new GoogleIdentity("already-here@example.com", "google-subject-existing"))));
        using var client = factory.CreateClient();

        await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("already-here@example.com", SomeVerifier, AccountRole.Professional),
            ApiJsonSerializerContext.Default.RegisterRequest);

        var response = await client.PostAsJsonAsync(
            "/auth/google",
            new GoogleAuthRequest("existing-google-token", AccountRole.Patient),
            ApiJsonSerializerContext.Default.GoogleAuthRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.GoogleAuthResponse);
        Assert.NotNull(body);
        Assert.Equal(AccountRole.Professional, body!.Role);
        Assert.False(body.IsNewAccount);
    }

    [Fact]
    public async Task PostGoogle_WithInvalidToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory(new StubGoogleIdentityProvider());
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/google",
            new GoogleAuthRequest("unrecognized-token", AccountRole.Patient),
            ApiJsonSerializerContext.Default.GoogleAuthRequest);

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
            ApiJsonSerializerContext.Default.GoogleAuthRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("idToken", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostRegister_WithPatientRole_ReturnsSessionTokens()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("patient-tokens@example.com", SomeVerifier, AccountRole.Patient),
            ApiJsonSerializerContext.Default.RegisterRequest);

        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);
        Assert.NotNull(body!.AccessToken);
        Assert.NotNull(body.RefreshToken);
    }

    /// <summary>A professional still owes 2FA at register time (ADR-S02-03), so no session exists yet.</summary>
    [Fact]
    public async Task PostRegister_WithProfessionalRole_DoesNotReturnSessionTokens()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("pro-no-tokens@example.com", SomeVerifier, AccountRole.Professional),
            ApiJsonSerializerContext.Default.RegisterRequest);

        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);
        Assert.Null(body!.AccessToken);
        Assert.Null(body.RefreshToken);
    }

    [Fact]
    public async Task PostRefresh_WithFreshlyIssuedRefreshToken_Returns200WithNewPair()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("refresh-ok@example.com", SomeVerifier, AccountRole.Patient),
            ApiJsonSerializerContext.Default.RegisterRequest);
        var issued = await registerResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);

        var response = await client.PostAsJsonAsync(
            "/auth/refresh",
            new RefreshTokenRequest(issued!.RefreshToken!),
            ApiJsonSerializerContext.Default.RefreshTokenRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RefreshTokenResponse);
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

        var registerResponse = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("refresh-reuse@example.com", SomeVerifier, AccountRole.Patient),
            ApiJsonSerializerContext.Default.RegisterRequest);
        var issued = await registerResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);
        await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest(issued!.RefreshToken!), ApiJsonSerializerContext.Default.RefreshTokenRequest);

        var response = await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest(issued.RefreshToken!), ApiJsonSerializerContext.Default.RefreshTokenRequest);

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

        var registerResponse = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("refresh-compare@example.com", SomeVerifier, AccountRole.Patient),
            ApiJsonSerializerContext.Default.RegisterRequest);
        var issued = await registerResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);
        await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest(issued!.RefreshToken!), ApiJsonSerializerContext.Default.RefreshTokenRequest);
        var reusedResponse = await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest(issued.RefreshToken!), ApiJsonSerializerContext.Default.RefreshTokenRequest);

        var unknownResponse = await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest("never-issued-token"), ApiJsonSerializerContext.Default.RefreshTokenRequest);

        Assert.Equal(reusedResponse.StatusCode, unknownResponse.StatusCode);
        Assert.Equal(await reusedResponse.Content.ReadAsStringAsync(), await unknownResponse.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task PostRefresh_WithMissingRefreshToken_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/refresh", new RefreshTokenRequest(""), ApiJsonSerializerContext.Default.RefreshTokenRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("refreshToken", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    // Must match what CreateMagicLinkAuthenticator's callers sign fake WebAuthn responses with.
    private const string WebAuthnRelyingPartyId = "limmiar.test";
    private const string WebAuthnOrigin = "https://limmiar.test";

    [Fact]
    public async Task PostMagicLinkRequest_WithValidEmail_Returns200()
    {
        var (factory, _) = CreateFactoryWithMagicLinkCapture();
        using var factoryDisposable = factory;
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/request",
            new MagicLinkRequestRequest("someone@example.com"),
            ApiJsonSerializerContext.Default.MagicLinkRequestRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task PostMagicLinkRequest_WithRealEmailSenderRegistration_Returns200WithEmptyBody()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/request",
            new MagicLinkRequestRequest("real-sender@example.com"),
            ApiJsonSerializerContext.Default.MagicLinkRequestRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal("{}", body);
    }

    [Fact]
    public async Task PostMagicLinkRequest_WithMissingEmail_Returns400WithValidationProblemDetails()
    {
        var (factory, _) = CreateFactoryWithMagicLinkCapture();
        using var factoryDisposable = factory;
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/request",
            new MagicLinkRequestRequest(""),
            ApiJsonSerializerContext.Default.MagicLinkRequestRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("email", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>Exercises Program.Composition.cs's MagicLink:TokenLifetimeSeconds E2E override branch -- same precedent as DevicePairing:SessionLifetimeSeconds.</summary>
    [Fact]
    public async Task PostMagicLinkRequest_WithConfiguredTokenLifetimeOverride_StillReturns200()
    {
        var (baseFactory, _) = CreateFactoryWithMagicLinkCapture();
        using var factory = baseFactory.WithWebHostBuilder(builder =>
            builder.UseSetting("MagicLink:TokenLifetimeSeconds", "5"));
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/request",
            new MagicLinkRequestRequest("override@example.com"),
            ApiJsonSerializerContext.Default.MagicLinkRequestRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task PostMagicLinkVerify_WithInvalidToken_Returns401WithMagicLinkInvalidProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/verify",
            new VerifyMagicLinkRequest("never-issued"),
            ApiJsonSerializerContext.Default.VerifyMagicLinkRequest);

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
            ApiJsonSerializerContext.Default.VerifyMagicLinkRequest);

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
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);

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
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("credentialId", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>Empty string (not merely non-base64) is the other half of TryDecodeBase64's required-field check.</summary>
    [Fact]
    public async Task PostMagicLinkWebAuthnComplete_WithEmptyCredentialId_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest("some-ticket", "", Convert.ToBase64String([1]), null, null, null),
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);

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
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);

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
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);

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
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);

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
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);

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
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("signature", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task MagicLinkFlow_RegistrationCeremony_EndToEnd_ReturnsSessionForNewPatientAccount()
    {
        var (factory, sender) = CreateFactoryWithMagicLinkCapture();
        using var factoryDisposable = factory;
        using var client = factory.CreateClient();
        const string email = "e2e-register@example.com";

        await client.PostAsJsonAsync(
            "/auth/magic-link/request", new MagicLinkRequestRequest(email), ApiJsonSerializerContext.Default.MagicLinkRequestRequest);
        var token = sender.LastTokenSentTo(email)!;

        var verifyResponse = await client.PostAsJsonAsync(
            "/auth/magic-link/verify", new VerifyMagicLinkRequest(token), ApiJsonSerializerContext.Default.VerifyMagicLinkRequest);
        Assert.Equal(HttpStatusCode.OK, verifyResponse.StatusCode);
        var verifyBody = await verifyResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.VerifyMagicLinkResponse);
        Assert.NotNull(verifyBody);
        Assert.Equal(MagicLinkCeremonyType.Register, verifyBody!.CeremonyType);
        Assert.Equal(WebAuthnRelyingPartyId, verifyBody.RelyingPartyId);
        Assert.Null(verifyBody.CredentialId);

        var authenticator = new SoftwareAuthenticator();
        var challengeBytes = Convert.FromBase64String(verifyBody.Challenge);
        var challenge = Base64Url.EncodeToString(challengeBytes);
        var clientDataJson = SoftwareAuthenticator.ClientDataJson("webauthn.create", challenge, WebAuthnOrigin);
        var attestationObject = authenticator.AttestationObject(WebAuthnRelyingPartyId);

        var completeResponse = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest(
                verifyBody.MagicLinkTicket,
                Convert.ToBase64String(authenticator.CredentialId),
                Convert.ToBase64String(clientDataJson),
                Convert.ToBase64String(attestationObject),
                null,
                null),
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.OK, completeResponse.StatusCode);
        var completeBody = await completeResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnResponse);
        Assert.NotNull(completeBody);
        Assert.Equal(email, completeBody!.Email);
        Assert.Equal(AccountRole.Patient, completeBody.Role);
        Assert.NotEmpty(completeBody.AccessToken);
        Assert.NotEmpty(completeBody.RefreshToken);
    }

    [Fact]
    public async Task MagicLinkFlow_AssertionCeremony_EndToEnd_ReturnsSessionForReturningPatient()
    {
        var (factory, sender) = CreateFactoryWithMagicLinkCapture();
        using var factoryDisposable = factory;
        using var client = factory.CreateClient();
        const string email = "e2e-assert@example.com";
        var authenticator = new SoftwareAuthenticator();

        await CompleteRegistrationCeremonyOverHttp(client, sender, email, authenticator);

        await client.PostAsJsonAsync(
            "/auth/magic-link/request", new MagicLinkRequestRequest(email), ApiJsonSerializerContext.Default.MagicLinkRequestRequest);
        var assertToken = sender.LastTokenSentTo(email)!;
        var verifyResponse = await client.PostAsJsonAsync(
            "/auth/magic-link/verify", new VerifyMagicLinkRequest(assertToken), ApiJsonSerializerContext.Default.VerifyMagicLinkRequest);
        var verifyBody = await verifyResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.VerifyMagicLinkResponse);
        Assert.Equal(MagicLinkCeremonyType.Assert, verifyBody!.CeremonyType);
        Assert.Equal(Convert.ToBase64String(authenticator.CredentialId), verifyBody.CredentialId);

        var challenge = Base64Url.EncodeToString(Convert.FromBase64String(verifyBody.Challenge));
        var clientDataJson = SoftwareAuthenticator.ClientDataJson("webauthn.get", challenge, WebAuthnOrigin);
        var authenticatorData = SoftwareAuthenticator.AuthenticatorData(WebAuthnRelyingPartyId, userPresent: true, userVerified: true, signCount: 5);
        var signature = authenticator.Sign(authenticatorData, clientDataJson);

        var completeResponse = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest(
                verifyBody.MagicLinkTicket,
                Convert.ToBase64String(authenticator.CredentialId),
                Convert.ToBase64String(clientDataJson),
                null,
                Convert.ToBase64String(authenticatorData),
                Convert.ToBase64String(signature)),
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.OK, completeResponse.StatusCode);
        var completeBody = await completeResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnResponse);
        Assert.NotNull(completeBody);
        Assert.Equal(email, completeBody!.Email);
        Assert.NotEmpty(completeBody.AccessToken);
    }

    /// <summary>A tampered signature must surface as the collapsed WebAuthn-ceremony problem code.</summary>
    [Fact]
    public async Task MagicLinkFlow_AssertionCeremony_WithTamperedSignature_Returns401WithCeremonyFailedProblemDetails()
    {
        var (factory, sender) = CreateFactoryWithMagicLinkCapture();
        using var factoryDisposable = factory;
        using var client = factory.CreateClient();
        const string email = "e2e-tampered@example.com";
        var authenticator = new SoftwareAuthenticator();

        await CompleteRegistrationCeremonyOverHttp(client, sender, email, authenticator);

        await client.PostAsJsonAsync(
            "/auth/magic-link/request", new MagicLinkRequestRequest(email), ApiJsonSerializerContext.Default.MagicLinkRequestRequest);
        var assertToken = sender.LastTokenSentTo(email)!;
        var verifyResponse = await client.PostAsJsonAsync(
            "/auth/magic-link/verify", new VerifyMagicLinkRequest(assertToken), ApiJsonSerializerContext.Default.VerifyMagicLinkRequest);
        var verifyBody = await verifyResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.VerifyMagicLinkResponse);

        var challenge = Base64Url.EncodeToString(Convert.FromBase64String(verifyBody!.Challenge));
        var clientDataJson = SoftwareAuthenticator.ClientDataJson("webauthn.get", challenge, WebAuthnOrigin);
        var authenticatorData = SoftwareAuthenticator.AuthenticatorData(WebAuthnRelyingPartyId, userPresent: true, userVerified: true, signCount: 1);
        var signature = authenticator.Sign(authenticatorData, clientDataJson);
        signature[^1] ^= 0xFF;

        var completeResponse = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest(
                verifyBody.MagicLinkTicket,
                Convert.ToBase64String(authenticator.CredentialId),
                Convert.ToBase64String(clientDataJson),
                null,
                Convert.ToBase64String(authenticatorData),
                Convert.ToBase64String(signature)),
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, completeResponse.StatusCode);
        var body = await completeResponse.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.webauthn_ceremony_failed", doc.RootElement.GetProperty("code").GetString());
    }

    private static async Task CompleteRegistrationCeremonyOverHttp(
        HttpClient client, CapturingMagicLinkEmailSender sender, string email, SoftwareAuthenticator authenticator)
    {
        await client.PostAsJsonAsync(
            "/auth/magic-link/request", new MagicLinkRequestRequest(email), ApiJsonSerializerContext.Default.MagicLinkRequestRequest);
        var token = sender.LastTokenSentTo(email)!;
        var verifyResponse = await client.PostAsJsonAsync(
            "/auth/magic-link/verify", new VerifyMagicLinkRequest(token), ApiJsonSerializerContext.Default.VerifyMagicLinkRequest);
        var verifyBody = await verifyResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.VerifyMagicLinkResponse);

        var challenge = Base64Url.EncodeToString(Convert.FromBase64String(verifyBody!.Challenge));
        var clientDataJson = SoftwareAuthenticator.ClientDataJson("webauthn.create", challenge, WebAuthnOrigin);
        var attestationObject = authenticator.AttestationObject(WebAuthnRelyingPartyId);

        var completeResponse = await client.PostAsJsonAsync(
            "/auth/magic-link/webauthn/complete",
            new CompleteMagicLinkWebAuthnRequest(
                verifyBody.MagicLinkTicket,
                Convert.ToBase64String(authenticator.CredentialId),
                Convert.ToBase64String(clientDataJson),
                Convert.ToBase64String(attestationObject),
                null,
                null),
            ApiJsonSerializerContext.Default.CompleteMagicLinkWebAuthnRequest);
        Assert.Equal(HttpStatusCode.OK, completeResponse.StatusCode);
    }

    /// <summary>The route is only mapped when MagicLink:TestCaptureEndpoint is true; proves it is genuinely unmapped, not merely unauthorized or empty.</summary>
    [Fact]
    public async Task GetMagicLinkDebugLast_WithoutTestCaptureFlag_RouteIsNotMapped()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/auth/magic-link/_debug-last?email=someone@example.com");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetMagicLinkDebugLast_WithTestCaptureFlagAndNoEmailQueryParam_Returns404()
    {
        using var factory = CreateFactoryWithTestCaptureEndpoint();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/auth/magic-link/_debug-last");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetMagicLinkDebugLast_WithTestCaptureFlagAndNothingCapturedForThatEmail_Returns404()
    {
        using var factory = CreateFactoryWithTestCaptureEndpoint();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/auth/magic-link/_debug-last?email=never-requested@example.com");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetMagicLinkDebugLast_WithTestCaptureFlagAfterARequest_ReturnsAWorkingToken()
    {
        using var factory = CreateFactoryWithTestCaptureEndpoint();
        using var client = factory.CreateClient();
        const string email = "debug-endpoint@example.com";

        var requestResponse = await client.PostAsJsonAsync(
            "/auth/magic-link/request", new MagicLinkRequestRequest(email), ApiJsonSerializerContext.Default.MagicLinkRequestRequest);
        Assert.Equal(HttpStatusCode.OK, requestResponse.StatusCode);

        var debugResponse = await client.GetAsync($"/auth/magic-link/_debug-last?email={Uri.EscapeDataString(email)}");
        Assert.Equal(HttpStatusCode.OK, debugResponse.StatusCode);

        var debugBody = await debugResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.MagicLinkDebugLastResponse);
        Assert.NotNull(debugBody);
        Assert.False(string.IsNullOrWhiteSpace(debugBody!.Token));

        // Not just "looks like a token" -- the exact token a real /auth/magic-link/verify call accepts.
        var verifyResponse = await client.PostAsJsonAsync(
            "/auth/magic-link/verify", new VerifyMagicLinkRequest(debugBody.Token), ApiJsonSerializerContext.Default.VerifyMagicLinkRequest);
        Assert.Equal(HttpStatusCode.OK, verifyResponse.StatusCode);
    }

    /// <summary>Sets MagicLink:TestCaptureEndpoint=true instead of overriding IMagicLinkEmailSender directly -- these tests are specifically about that config-gated wiring.</summary>
    private static WebApplicationFactory<Program> CreateFactoryWithTestCaptureEndpoint() =>
        CreateFactory().WithWebHostBuilder(builder =>
            builder.UseSetting("MagicLink:TestCaptureEndpoint", "true"));

    private static WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                // Never touches Postgres, but startup still needs a syntactically valid
                // ConnectionStrings:AppDb to construct the NpgsqlDataSource singleton.
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", WebAuthnRelyingPartyId);
                builder.UseSetting("WebAuthn:ExpectedOrigin", WebAuthnOrigin);
            });

    /// <summary>Overrides the production IMagicLinkEmailSender registration with a capturing fake so a test can read back the token a request "sent".</summary>
    private static (WebApplicationFactory<Program> Factory, CapturingMagicLinkEmailSender Sender) CreateFactoryWithMagicLinkCapture()
    {
        var sender = new CapturingMagicLinkEmailSender();
        var factory = CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<IMagicLinkEmailSender>(sender)));
        return (factory, sender);
    }

    /// <summary>Real Google ID token verification is out of scope for S02-01; overrides the production IGoogleIdentityProvider registration with a fake.</summary>
    private static WebApplicationFactory<Program> CreateFactory(IGoogleIdentityProvider googleIdentityProvider) =>
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
        var verifier = new byte[AccountService.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }
}
