using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Accounts;
using Api.Serialization;
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

    /// <summary>
    /// S02-01 acceptance criterion: "Resposta idêntica, no mesmo tempo, para e-mail
    /// inexistente e senha errada". Asserts the two failure responses are byte-identical
    /// at the HTTP layer -- status, content-type, and body -- so a client (or an attacker
    /// probing for registered e-mails) cannot distinguish the two cases from the response
    /// alone. AccountServiceTests separately proves the domain layer does equal
    /// computational work (comparer invoked once, same length) on both paths.
    /// </summary>
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

    /// <summary>
    /// Covers the "field present in JSON but null" shape, distinct from the
    /// wrong-length-array case already covered by
    /// PostRegister_WithWrongLengthVerifier_Returns400WithValidationProblemDetails --
    /// TryValidateCredentialsShape's null-check and length-check are separate branches.
    /// </summary>
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

    /// <summary>S02-01 acceptance criterion: "Google resolve o papel sozinho quando o
    /// e-mail já existe" -- registers a professional by e-mail first, then signs in via
    /// Google with the SAME e-mail but requesting the "patient" role; the response must
    /// carry the account's real (professional) role, not the requested one, and must not
    /// report a new account.</summary>
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

    private static WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                // Auth endpoints under test here never touch Postgres (IAccountStore's
                // default DI registration is the in-memory placeholder), but app startup
                // still needs a syntactically valid ConnectionStrings:AppDb to construct
                // the NpgsqlDataSource singleton -- same reasoning as HealthEndpointTests.
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
            });

    /// <summary>
    /// Real Google ID token verification is out of scope for S02-01 (see
    /// GoogleIdentityProvider's own TODO) -- every test that reaches /auth/google
    /// overrides the production IGoogleIdentityProvider registration with this fake.
    /// </summary>
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
