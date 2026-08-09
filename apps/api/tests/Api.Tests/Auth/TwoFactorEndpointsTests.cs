using System.Net;
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
/// S02-03/S02-04 endpoint tests: mandatory TOTP enrollment (begin/confirm) and login
/// challenge (code or backup code), plus the negative regression proving no support-side
/// 2FA reset/disable route exists (ADR-S02-04).
///
/// Security-review fix: every call into these 3 endpoints now needs a valid two-factor
/// ticket (see <see cref="ITwoFactorTicketIssuer"/>) for the target accountId, minted by
/// /auth/register or /auth/login. Most tests below thread the real ticket through the real
/// flow (register/login -> ticket -> begin/confirm/challenge) using the production
/// <see cref="TwoFactorTicketIssuer"/>. A handful of tests only care about a downstream
/// AccountService mapping (e.g. "unknown accountId still returns 404") that a ticket bound
/// to a real account could never reach -- those use <see cref="CreateFactoryWithTicketBypass"/>,
/// which swaps in a stub <see cref="ITwoFactorTicketIssuer"/> that treats any ticket as
/// valid, the same way the other stub providers in this file work.
/// </summary>
public sealed class TwoFactorEndpointsTests
{
    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);

    /// <summary>Fixed code the stub provider always treats as valid, regardless of secret/timestamp -- same override pattern the other endpoint tests use for external providers.</summary>
    private const string ValidStubCode = "111111";

    [Fact]
    public async Task PostTotp_WithProfessionalAccount_Returns200WithSecretAndProvisioningUri()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, ticket) = await RegisterProfessionalAsync(client, "totp-begin-ok@example.com");

        var response = await PostBeginAsync(client, accountId, ticket);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.BeginTotpEnrollmentResponse);
        Assert.NotNull(body);
        Assert.False(string.IsNullOrWhiteSpace(body!.Secret));
        Assert.Contains(body.Secret, body.ProvisioningUri);
    }

    [Fact]
    public async Task PostTotp_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithTicketBypass();
        using var client = factory.CreateClient();

        var response = await PostBeginAsync(client, Guid.NewGuid(), "any-ticket");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostTotp_WithPatientAccount_Returns409WithProblemDetails()
    {
        using var factory = CreateFactoryWithTicketBypass();
        using var client = factory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest("totp-patient@example.com", SomeVerifier, AccountRole.Patient),
            ApiJsonSerializerContext.Default.RegisterRequest);
        var registered = await registerResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);

        var response = await PostBeginAsync(client, registered!.Id, "any-ticket");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.not_a_professional_account", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostTotp_WhenAlreadyEnabled_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var email = "totp-already-enabled@example.com";
        var (accountId, ticket) = await RegisterProfessionalAsync(client, email);
        await PostBeginAsync(client, accountId, ticket);
        await PostConfirmAsync(client, accountId, ticket, ValidStubCode);

        // The registration ticket was invalidated by the successful confirm above --
        // logging in again mints a fresh one, exactly like a real caller would need to.
        var secondTicket = await LoginAsync(client, email);
        var response = await PostBeginAsync(client, accountId, secondTicket);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.totp_already_enabled", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostConfirm_WithValidCode_Returns200With10BackupCodes()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, ticket) = await RegisterProfessionalAsync(client, "totp-confirm-ok@example.com");
        await PostBeginAsync(client, accountId, ticket);

        var response = await PostConfirmAsync(client, accountId, ticket, ValidStubCode);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.ConfirmTotpEnrollmentResponse);
        Assert.NotNull(body);
        Assert.Equal(10, body!.BackupCodes.Count);
    }

    [Fact]
    public async Task PostConfirm_WithMissingCode_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, ticket) = await RegisterProfessionalAsync(client, "totp-confirm-missing-code@example.com");
        await PostBeginAsync(client, accountId, ticket);

        var response = await PostConfirmAsync(client, accountId, ticket, "");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("code", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostConfirm_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithTicketBypass();
        using var client = factory.CreateClient();

        var response = await PostConfirmAsync(client, Guid.NewGuid(), "any-ticket", ValidStubCode);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostConfirm_WithNoPendingEnrollment_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, ticket) = await RegisterProfessionalAsync(client, "totp-confirm-not-pending@example.com");

        var response = await PostConfirmAsync(client, accountId, ticket, ValidStubCode);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.totp_not_pending", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostConfirm_WithInvalidCode_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, ticket) = await RegisterProfessionalAsync(client, "totp-confirm-invalid@example.com");
        await PostBeginAsync(client, accountId, ticket);

        var response = await PostConfirmAsync(client, accountId, ticket, "000000");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.totp_invalid_code", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostChallenge_WithValidCode_Returns200WithLoginResponse()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var email = "totp-challenge-code@example.com";
        var (accountId, ticket) = await RegisterProfessionalAsync(client, email);
        await PostBeginAsync(client, accountId, ticket);
        await PostConfirmAsync(client, accountId, ticket, ValidStubCode);
        var loginTicket = await LoginAsync(client, email);

        var response = await PostChallengeAsync(client, accountId, loginTicket, ValidStubCode, null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.LoginResponse);
        Assert.NotNull(body);
        Assert.Equal(accountId, body!.Id);
    }

    [Fact]
    public async Task PostChallenge_WithValidBackupCode_Returns200WithLoginResponse()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var email = "totp-challenge-backup@example.com";
        var (accountId, ticket) = await RegisterProfessionalAsync(client, email);
        await PostBeginAsync(client, accountId, ticket);
        var confirmResponse = await PostConfirmAsync(client, accountId, ticket, ValidStubCode);
        var confirmed = await confirmResponse.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.ConfirmTotpEnrollmentResponse);
        var backupCode = confirmed!.BackupCodes[0];
        var loginTicket = await LoginAsync(client, email);

        var response = await PostChallengeAsync(client, accountId, loginTicket, null, backupCode);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.LoginResponse);
        Assert.NotNull(body);
        Assert.Equal(accountId, body!.Id);
    }

    [Fact]
    public async Task PostChallenge_WithNeitherCodeNorBackupCode_Returns400WithValidationProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var email = "totp-challenge-missing@example.com";
        var (accountId, ticket) = await RegisterProfessionalAsync(client, email);
        await PostBeginAsync(client, accountId, ticket);
        await PostConfirmAsync(client, accountId, ticket, ValidStubCode);
        var loginTicket = await LoginAsync(client, email);

        var response = await PostChallengeAsync(client, accountId, loginTicket, null, null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostChallenge_WithInvalidCode_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var email = "totp-challenge-invalid@example.com";
        var (accountId, ticket) = await RegisterProfessionalAsync(client, email);
        await PostBeginAsync(client, accountId, ticket);
        await PostConfirmAsync(client, accountId, ticket, ValidStubCode);
        var loginTicket = await LoginAsync(client, email);

        var response = await PostChallengeAsync(client, accountId, loginTicket, "000000", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.totp_invalid_code", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostChallenge_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithTicketBypass();
        using var client = factory.CreateClient();

        var response = await PostChallengeAsync(client, Guid.NewGuid(), "any-ticket", ValidStubCode, null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostChallenge_WhenNeverEnabled_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, ticket) = await RegisterProfessionalAsync(client, "totp-challenge-not-enabled@example.com");

        var response = await PostChallengeAsync(client, accountId, ticket, ValidStubCode, null);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.totp_not_enabled", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>
    /// Security-review regression: without this check, any caller who could
    /// guess/discover a professional's accountId could hit begin/confirm/challenge with no
    /// ticket at all and no proof they ever passed register/login/Google for that account.
    /// </summary>
    [Fact]
    public async Task PostTotp_WithoutValidTicket_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterProfessionalAsync(client, "totp-begin-no-ticket@example.com");

        var response = await PostBeginAsync(client, accountId, "not-a-real-ticket");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.totp_ticket_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostConfirm_WithoutValidTicket_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, ticket) = await RegisterProfessionalAsync(client, "totp-confirm-no-ticket@example.com");
        await PostBeginAsync(client, accountId, ticket);

        var response = await PostConfirmAsync(client, accountId, "not-a-real-ticket", ValidStubCode);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.totp_ticket_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostChallenge_WithoutValidTicket_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var email = "totp-challenge-no-ticket@example.com";
        var (accountId, ticket) = await RegisterProfessionalAsync(client, email);
        await PostBeginAsync(client, accountId, ticket);
        await PostConfirmAsync(client, accountId, ticket, ValidStubCode);

        var response = await PostChallengeAsync(client, accountId, "not-a-real-ticket", ValidStubCode, null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.totp_ticket_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>
    /// THE core account-takeover regression (security-review finding): a ticket minted for
    /// account A must not authorize a begin/confirm/challenge call against account B's
    /// accountId, even though the ticket is otherwise valid (issued, unexpired). Without
    /// this check, <see cref="ITwoFactorTicketIssuer.Validate"/> could be reduced to "does
    /// any ticket exist", which would not close the original vulnerability at all.
    /// </summary>
    [Fact]
    public async Task PostTotp_WithTicketIssuedForAnotherAccount_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (_, ticketForAccountA) = await RegisterProfessionalAsync(client, "cross-account-a@example.com");
        var (accountIdB, _) = await RegisterProfessionalAsync(client, "cross-account-b@example.com");

        var response = await PostBeginAsync(client, accountIdB, ticketForAccountA);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.totp_ticket_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostConfirm_WithTicketIssuedForAnotherAccount_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountIdA, ticketForAccountA) = await RegisterProfessionalAsync(client, "cross-account-confirm-a@example.com");
        await PostBeginAsync(client, accountIdA, ticketForAccountA);
        var (accountIdB, _) = await RegisterProfessionalAsync(client, "cross-account-confirm-b@example.com");

        var response = await PostConfirmAsync(client, accountIdB, ticketForAccountA, ValidStubCode);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.totp_ticket_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostChallenge_WithTicketIssuedForAnotherAccount_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var emailA = "cross-account-challenge-a@example.com";
        var (accountIdA, ticketA) = await RegisterProfessionalAsync(client, emailA);
        await PostBeginAsync(client, accountIdA, ticketA);
        await PostConfirmAsync(client, accountIdA, ticketA, ValidStubCode);
        var loginTicketForAccountA = await LoginAsync(client, emailA);
        var (accountIdB, _) = await RegisterProfessionalAsync(client, "cross-account-challenge-b@example.com");

        var response = await PostChallengeAsync(client, accountIdB, loginTicketForAccountA, ValidStubCode, null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.totp_ticket_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    /// <summary>
    /// ADR-S02-04 regression: there is deliberately no support-side way to reset or disable
    /// 2FA -- the only account-recovery path is a single-use backup code. No route template
    /// for a "reset" action exists at all, so it's simply unmapped (404).
    /// </summary>
    [Fact]
    public async Task NoSupportSideTotpResetRouteExists()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterProfessionalAsync(client, "no-reset-route@example.com");

        var response = await client.PostAsync($"/accounts/{accountId}/totp/reset", content: null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    /// <summary>
    /// Same ADR-S02-04 guarantee, RESTful-DELETE flavor. This path template DOES exist (it's
    /// the same one <c>POST /accounts/{accountId}/totp</c> is mapped on), so ASP.NET Core's
    /// routing correctly reports 405 Method Not Allowed rather than 404 for the mismatched
    /// verb -- but 405 proves the same thing 404 would: there is no endpoint that actually
    /// disables/resets 2FA here. Only a real 200 would be cause for concern.
    /// </summary>
    [Fact]
    public async Task NoSupportSideTotpDisableRouteExists()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterProfessionalAsync(client, "no-disable-route@example.com");

        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/accounts/{accountId}/totp");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }

    private static Task<HttpResponseMessage> PostBeginAsync(HttpClient client, Guid accountId, string ticket) =>
        client.PostAsJsonAsync(
            $"/accounts/{accountId}/totp",
            new BeginTotpEnrollmentRequest(ticket),
            ApiJsonSerializerContext.Default.BeginTotpEnrollmentRequest);

    private static Task<HttpResponseMessage> PostConfirmAsync(HttpClient client, Guid accountId, string ticket, string code) =>
        client.PostAsJsonAsync(
            $"/accounts/{accountId}/totp/confirm",
            new ConfirmTotpEnrollmentRequest(ticket, code),
            ApiJsonSerializerContext.Default.ConfirmTotpEnrollmentRequest);

    private static Task<HttpResponseMessage> PostChallengeAsync(HttpClient client, Guid accountId, string ticket, string? code, string? backupCode) =>
        client.PostAsJsonAsync(
            $"/accounts/{accountId}/totp/challenge",
            new TotpChallengeRequest(ticket, code, backupCode),
            ApiJsonSerializerContext.Default.TotpChallengeRequest);

    private static async Task<(Guid Id, string Ticket)> RegisterProfessionalAsync(HttpClient client, string email)
    {
        var response = await client.PostAsJsonAsync(
            "/auth/register",
            new RegisterRequest(email, SomeVerifier, AccountRole.Professional),
            ApiJsonSerializerContext.Default.RegisterRequest);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.RegisterResponse);
        return (body!.Id, body.TwoFactorTicket!);
    }

    /// <summary>Mints a fresh two-factor ticket the same way a real client would: by logging in again.</summary>
    private static async Task<string> LoginAsync(HttpClient client, string email)
    {
        var response = await client.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest(email, SomeVerifier),
            ApiJsonSerializerContext.Default.LoginRequest);
        var body = await response.Content.ReadFromJsonAsync(ApiJsonSerializerContext.Default.LoginResponse);
        return body!.TwoFactorTicket!;
    }

    /// <summary>
    /// Every test here overrides the production <see cref="ITotpProvider"/> registration
    /// with <see cref="StubTotpProvider"/> -- TOTP itself is real and already covered by
    /// Api.Tests/Accounts/TotpProviderTests; these tests only need a deterministic code
    /// (<see cref="ValidStubCode"/>) to drive the HTTP layer, not to re-verify RFC 6238 math
    /// over HTTP.
    /// </summary>
    private static WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                // Same reasoning as AuthEndpointsTests.CreateFactory: these endpoints never
                // touch Postgres, but app startup still needs a syntactically valid
                // ConnectionStrings:AppDb to construct the NpgsqlDataSource singleton.
                builder.UseSetting("ConnectionStrings:AppDb", "Host=127.0.0.1;Port=1;Username=app_role;Password=unused;");
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
                builder.ConfigureTestServices(services => services.AddSingleton<ITotpProvider>(new StubTotpProvider()));
            });

    /// <summary>
    /// For tests that only care about a downstream AccountService mapping (e.g. "unknown
    /// accountId returns 404") a ticket bound to a real account can never reach -- swaps in
    /// a stub <see cref="ITwoFactorTicketIssuer"/> that treats any ticket as valid, so the
    /// call passes straight through to <see cref="Api.Accounts.AccountService"/>.
    /// </summary>
    private static WebApplicationFactory<Program> CreateFactoryWithTicketBypass() =>
        CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<ITwoFactorTicketIssuer>(new AlwaysValidTwoFactorTicketIssuer())));

    private sealed class StubTotpProvider : ITotpProvider
    {
        public string GenerateSecret() => "STUBBEDSECRET";

        public string BuildProvisioningUri(string secret, string accountEmail, string issuer) =>
            $"otpauth://totp/{issuer}:{accountEmail}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30";

        public bool ValidateCode(string secret, string code, DateTimeOffset timestamp) => code == ValidStubCode;
    }

    private sealed class AlwaysValidTwoFactorTicketIssuer : ITwoFactorTicketIssuer
    {
        public string Issue(Guid accountId) => "stub-ticket";

        public bool Validate(string ticket, Guid accountId) => true;

        public void Invalidate(string ticket)
        {
        }
    }

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountService.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }
}
