using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Accounts;
using Api.Serialization;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests.Accounts;

/// <summary>
/// S06-02 backend: PUT/GET/DELETE Account.VoiceEnrollment (the cadastro de voz). No Postgres
/// needed -- Account lives in InMemoryAccountStore (same reason RecoveryEndpointsTests doesn't
/// use the Database collection either).
/// </summary>
public sealed class VoiceEnrollmentEndpointsTests
{
    private const string ValidStubCode = "111111";

    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    [Fact]
    public async Task PutVoiceEnrollment_WithValidBlobs_Returns204AndPersists()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "voice-put@example.com");
        var wrappedDek = SomeSealedBlob(0x01);
        var sealedEmbedding = SomeSealedBlob(0x02);

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/voice-enrollment",
            new VoiceEnrollmentRequest(wrappedDek, sealedEmbedding),
            AccountsJsonContext.Default.VoiceEnrollmentRequest);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var getResponse = await client.GetAsync($"/accounts/{accountId}/voice-enrollment");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var body = await getResponse.Content.ReadFromJsonAsync(AccountsJsonContext.Default.VoiceEnrollmentResponse);
        Assert.NotNull(body);
        Assert.Equal(wrappedDek, body!.WrappedDek);
        Assert.Equal(sealedEmbedding, body.SealedEmbedding);
    }

    [Fact]
    public async Task PutVoiceEnrollment_WithTooShortBlob_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "voice-put-short@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/voice-enrollment",
            new VoiceEnrollmentRequest([0xAA], SomeSealedBlob(0x02)),
            AccountsJsonContext.Default.VoiceEnrollmentRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("wrappedDek", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>Same floor validation applies to sealedEmbedding, checked after wrappedDek -- own call site, own test, same as PatientEndpoints checking ciphertext after wrappedDek.</summary>
    [Fact]
    public async Task PutVoiceEnrollment_WithTooShortSealedEmbedding_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "voice-put-short-embedding@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/voice-enrollment",
            new VoiceEnrollmentRequest(SomeSealedBlob(0x01), [0xAA]),
            AccountsJsonContext.Default.VoiceEnrollmentRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("sealedEmbedding", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    /// <summary>A valid bearer token for a DIFFERENT account than the one in the route must not authorize -- same wrong-owner shape as PatientEndpointsTests's equivalent test.</summary>
    [Fact]
    public async Task PutVoiceEnrollment_WithTokenForDifferentAccount_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterProfessionalAsync(client, "voice-wrong-owner@example.com");

        using var otherClient = factory.CreateClient();
        var otherAccountId = await RegisterProfessionalAsync(otherClient, "voice-wrong-owner-target@example.com");

        var response = await client.PutAsJsonAsync(
            $"/accounts/{otherAccountId}/voice-enrollment",
            new VoiceEnrollmentRequest(SomeSealedBlob(0x01), SomeSealedBlob(0x02)),
            AccountsJsonContext.Default.VoiceEnrollmentRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PutVoiceEnrollment_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PutAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/voice-enrollment",
            new VoiceEnrollmentRequest(SomeSealedBlob(0x01), SomeSealedBlob(0x02)),
            AccountsJsonContext.Default.VoiceEnrollmentRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task GetVoiceEnrollment_WithoutPriorEnrollment_Returns404WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "voice-get-404@example.com");

        var response = await client.GetAsync($"/accounts/{accountId}/voice-enrollment");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("voice.enrollment_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task GetVoiceEnrollment_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/accounts/{Guid.NewGuid()}/voice-enrollment");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task DeleteVoiceEnrollment_AfterPut_Returns204AndClearsFields_ThenGetReturns404()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "voice-delete@example.com");
        await client.PutAsJsonAsync(
            $"/accounts/{accountId}/voice-enrollment",
            new VoiceEnrollmentRequest(SomeSealedBlob(0x01), SomeSealedBlob(0x02)),
            AccountsJsonContext.Default.VoiceEnrollmentRequest);

        var deleteResponse = await client.DeleteAsync($"/accounts/{accountId}/voice-enrollment");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var getResponse = await client.GetAsync($"/accounts/{accountId}/voice-enrollment");
        Assert.Equal(HttpStatusCode.NotFound, getResponse.StatusCode);
    }

    /// <summary>Deleting a cadastro that was never registered is a 404, not a silent no-op 204 -- there is nothing to delete.</summary>
    [Fact]
    public async Task DeleteVoiceEnrollment_WithoutPriorEnrollment_Returns404WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "voice-delete-404@example.com");

        var response = await client.DeleteAsync($"/accounts/{accountId}/voice-enrollment");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("voice.enrollment_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task DeleteVoiceEnrollment_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.DeleteAsync($"/accounts/{Guid.NewGuid()}/voice-enrollment");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>Re-cadastro substitutes, it does not accumulate or conflict -- PUT is idempotent, never 409.</summary>
    [Fact]
    public async Task PutVoiceEnrollment_TwiceForSameAccount_SecondPutReplacesTheFirst()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalAsync(client, "voice-put-twice@example.com");
        await client.PutAsJsonAsync(
            $"/accounts/{accountId}/voice-enrollment",
            new VoiceEnrollmentRequest(SomeSealedBlob(0x01), SomeSealedBlob(0x02)),
            AccountsJsonContext.Default.VoiceEnrollmentRequest);

        var secondWrappedDek = SomeSealedBlob(0x03);
        var secondSealedEmbedding = SomeSealedBlob(0x04);
        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/voice-enrollment",
            new VoiceEnrollmentRequest(secondWrappedDek, secondSealedEmbedding),
            AccountsJsonContext.Default.VoiceEnrollmentRequest);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var getResponse = await client.GetAsync($"/accounts/{accountId}/voice-enrollment");
        var body = await getResponse.Content.ReadFromJsonAsync(AccountsJsonContext.Default.VoiceEnrollmentResponse);
        Assert.NotNull(body);
        Assert.Equal(secondWrappedDek, body!.WrappedDek);
        Assert.Equal(secondSealedEmbedding, body.SealedEmbedding);
    }

    /// <summary>A real access token can never resolve to an unknown account (session tokens are only ever issued for accounts that exist in InMemoryAccountStore), so this swaps in a stub that treats any GUID-shaped bearer token as proof for that exact account, reaching VoiceEnrollmentService's AccountNotFound branch in isolation -- same technique as PatientEndpointsTests.PostPatient_WithUnknownAccountId_Returns404WithProblemDetails.</summary>
    [Fact]
    public async Task PutVoiceEnrollment_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.PutAsJsonAsync(
            $"/accounts/{accountId}/voice-enrollment",
            new VoiceEnrollmentRequest(SomeSealedBlob(0x01), SomeSealedBlob(0x02)),
            AccountsJsonContext.Default.VoiceEnrollmentRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Same bypass technique as the PUT test above, reaching VoiceEnrollmentService.GetAsync with an account that does not exist -- regression test for the account! null-dereference that used to throw instead of returning 404 (ronda 2, B2).</summary>
    [Fact]
    public async Task GetVoiceEnrollment_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.GetAsync($"/accounts/{accountId}/voice-enrollment");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("voice.enrollment_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Same bypass technique as the PUT test above, reaching VoiceEnrollmentService.DeleteAsync's AccountNotFound branch specifically -- distinct from the NotEnrolled branch (DeleteVoiceEnrollment_WithoutPriorEnrollment_Returns404WithProblemDetails), which fires for a real account that just has no cadastro.</summary>
    [Fact]
    public async Task DeleteVoiceEnrollment_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.DeleteAsync($"/accounts/{accountId}/voice-enrollment");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>Registers a Professional and completes mandatory TOTP enrollment (ADR-S02-03), leaving client carrying the real access token as its default Bearer header. Verification status doesn't matter here -- voice enrollment is gated by account ownership only (EndpointHelpers.IsAuthorizedForAccount), not AccountAuthorizationGuard.CanCreatePatientRecords.</summary>
    private static async Task<Guid> RegisterProfessionalAsync(HttpClient client, string email)
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

    /// <summary>A structurally valid (>= the 28-byte AES-GCM floor) opaque blob -- same helper shape as PatientEndpointsTests.SomeSealedBlob.</summary>
    private static byte[] SomeSealedBlob(byte fill)
    {
        var blob = new byte[28];
        Array.Fill(blob, fill);
        return blob;
    }

    private static WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
                builder.ConfigureTestServices(services => services.AddSingleton<ITotpProvider>(new StubTotpProvider()));
            });

    private static WebApplicationFactory<Program> CreateFactoryWithSessionBypass() =>
        CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<ISessionTokenIssuer>(new AlwaysValidSessionTokenIssuer())));

    private sealed class StubTotpProvider : ITotpProvider
    {
        public string GenerateSecret() => "STUBBEDSECRET";

        public string BuildProvisioningUri(string secret, string accountEmail, string issuer) =>
            $"otpauth://totp/{issuer}:{accountEmail}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30";

        public bool ValidateCode(string secret, string code, DateTimeOffset timestamp) => code == ValidStubCode;
    }

    private sealed class AlwaysValidSessionTokenIssuer : ISessionTokenIssuer
    {
        public SessionTokenPair IssuePair(Guid accountId) => throw new NotSupportedException("not needed by the tests that use this stub");

        public RefreshSessionResult Refresh(string refreshToken) => throw new NotSupportedException("not needed by the tests that use this stub");

        public Guid? ValidateAccess(string accessToken) => Guid.TryParse(accessToken, out var accountId) ? accountId : null;
    }
}
