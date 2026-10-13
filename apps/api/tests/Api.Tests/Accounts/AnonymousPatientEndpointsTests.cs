using System.Buffers.Text;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Api.Accounts;
using Api.PatientLinks;
using Api.Patients;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.Accounts;

[Collection("Database")]
public sealed class AnonymousPatientEndpointsTests(PostgresContainerFixture fixture) : IAsyncLifetime
{
    private const string Rp = "limmiar.test";
    private const string Origin = "https://limmiar.test";

    public async Task InitializeAsync()
    {
        await using var connection = new NpgsqlConnection(fixture.AdminConnectionString);
        await connection.OpenAsync();
        var reset = await Respawner.CreateAsync(connection, new RespawnerOptions { SchemasToInclude = ["public"], DbAdapter = DbAdapter.Postgres });
        await reset.ResetAsync(connection);
    }
    public Task DisposeAsync() => Task.CompletedTask;

    private WebApplicationFactory<Program> Factory() => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
        builder.UseSetting("ConnectionStrings:AppDb", fixture.AppRoleConnectionString);
        builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
        builder.UseSetting("WebAuthn:RelyingPartyId", Rp);
        builder.UseSetting("WebAuthn:ExpectedOrigin", Origin);
        builder.UseSetting("Totp:EncryptionKey", TotpTestEncryptionKey.Base64);
        builder.UseSetting("AbacatePay:WebhookSecret", "whsec_test123");
    });

    private static async Task<(Account Professional, Guid PatientId, string Code)> InviteAsync(WebApplicationFactory<Program> factory,
        Account? professional = null, Guid? patientId = null)
    {
        using var client = factory.CreateClient();
        professional ??= new Account(Guid.NewGuid(), $"{Guid.NewGuid()}@example.test", AccountRole.Professional, null, null,
            TotpSecret: "SOMESECRET", TotpEnabledAt: DateTimeOffset.UtcNow);
        var accounts = factory.Services.GetRequiredService<IAccountStore>();
        if (await accounts.FindByIdAsync(professional.Id, CancellationToken.None) is null) await accounts.InsertAsync(professional, CancellationToken.None);
        var tokens = factory.Services.GetRequiredService<ISessionTokenIssuer>().IssuePair(professional.Id);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.AccessToken);
        var recordId = patientId ?? Guid.NewGuid();
        if (patientId is null)
        {
            var create = await client.PostAsJsonAsync($"/accounts/{professional.Id}/patients", new CreatePatientRequest(recordId, new byte[60], new byte[28]), PatientsJsonContext.Default.CreatePatientRequest);
            Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        }
        var invite = await client.PostAsync($"/accounts/{professional.Id}/patients/{recordId}/link-invites", null);
        Assert.Equal(HttpStatusCode.Created, invite.StatusCode);
        var body = await invite.Content.ReadFromJsonAsync(PatientLinksJsonContext.Default.CreateLinkInviteResponse);
        return (professional, recordId, body!.Code);
    }

    private static async Task<VerifyMagicLinkResponse> VerifyAsync(HttpClient client, string code, Guid? accountId = null)
    {
        var response = await client.PostAsJsonAsync("/auth/magic-link/verify", new VerifyMagicLinkRequest(code, accountId), AccountsJsonContext.Default.VerifyMagicLinkRequest);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync(AccountsJsonContext.Default.VerifyMagicLinkResponse))!;
    }

    private static CompleteMagicLinkWebAuthnRequest Registration(VerifyMagicLinkResponse challenge, SoftwareAuthenticator authenticator, bool wrongChallenge = false) =>
        new(challenge.MagicLinkTicket, Convert.ToBase64String(authenticator.CredentialId),
            Convert.ToBase64String(SoftwareAuthenticator.ClientDataJson("webauthn.create", wrongChallenge ? "wrong" : Base64Url.EncodeToString(Convert.FromBase64String(challenge.Challenge)), Origin)),
            Convert.ToBase64String(authenticator.AttestationObject(Rp)), null, null);

    private static CompleteMagicLinkWebAuthnRequest Assertion(VerifyMagicLinkResponse challenge, SoftwareAuthenticator authenticator, uint counter)
    {
        var clientData = SoftwareAuthenticator.ClientDataJson("webauthn.get", Base64Url.EncodeToString(Convert.FromBase64String(challenge.Challenge)), Origin);
        var authData = SoftwareAuthenticator.AuthenticatorData(Rp, true, true, counter);
        return new(challenge.MagicLinkTicket, Convert.ToBase64String(authenticator.CredentialId), Convert.ToBase64String(clientData), null,
            Convert.ToBase64String(authData), Convert.ToBase64String(authenticator.Sign(authData, clientData)));
    }

    [Fact]
    public async Task RealHttpFlow_RegisterThenAssertAtAnotherProfessional_UsesSameAnonymousAccount()
    {
        using var factory = Factory();
        using var patient = factory.CreateClient();
        var (_, firstRecord, firstCode) = await InviteAsync(factory);
        var first = await VerifyAsync(patient, firstCode);
        var authenticator = new SoftwareAuthenticator();
        var registration = await patient.PostAsJsonAsync("/auth/magic-link/webauthn/complete", Registration(first, authenticator), AccountsJsonContext.Default.CompleteMagicLinkWebAuthnRequest);
        Assert.Equal(HttpStatusCode.OK, registration.StatusCode);
        var registered = (await registration.Content.ReadFromJsonAsync(AccountsJsonContext.Default.CompleteMagicLinkWebAuthnResponse))!;
        Assert.Equal(first.AccountId, registered.Id);
        Assert.Null(registered.Email);
        Assert.Equal(AccountRole.Patient, registered.Role);
        var (_, secondRecord, secondCode) = await InviteAsync(factory);
        var second = await VerifyAsync(patient, secondCode, registered.Id);
        Assert.Equal(MagicLinkCeremonyType.Assert, second.CeremonyType);
        Assert.Equal(registered.Id, second.AccountId);
        var assertion = await patient.PostAsJsonAsync("/auth/magic-link/webauthn/complete", Assertion(second, authenticator, 1), AccountsJsonContext.Default.CompleteMagicLinkWebAuthnRequest);
        Assert.Equal(HttpStatusCode.OK, assertion.StatusCode);
        var session = (await assertion.Content.ReadFromJsonAsync(AccountsJsonContext.Default.CompleteMagicLinkWebAuthnResponse))!;
        Assert.Equal(registered.Id, session.Id);
        Assert.Null(session.Email);
        patient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        var links = await patient.GetFromJsonAsync($"/accounts/{session.Id}/links", PatientLinksJsonContext.Default.IReadOnlyListLinkView);
        Assert.Equal(2, links!.Count);
        Assert.NotEqual(firstRecord, secondRecord);
        Assert.All(links, link => Assert.Equal(session.Id, link.PatientAccountId));
        await using var connection = new NpgsqlConnection(fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*), count(*) FILTER (WHERE email IS NOT NULL OR password_verifier_sha256 IS NOT NULL OR google_subject_id IS NOT NULL) FROM accounts WHERE role = 'Patient'";
        await using var rows = await command.ExecuteReaderAsync();
        Assert.True(await rows.ReadAsync());
        Assert.Equal(1L, rows.GetInt64(0));
        Assert.Equal(0L, rows.GetInt64(1));
    }

    [Fact]
    public async Task WrongChallenge_FailsWithoutAccountOrLink_AndBurnsOnlyCeremonyTicket()
    {
        using var factory = Factory();
        using var patient = factory.CreateClient();
        var (_, _, code) = await InviteAsync(factory);
        var verify = await VerifyAsync(patient, code);
        var auth = new SoftwareAuthenticator();
        foreach (var wrong in new[] { true, false })
        {
            var result = await patient.PostAsJsonAsync("/auth/magic-link/webauthn/complete", Registration(verify, auth, wrong), AccountsJsonContext.Default.CompleteMagicLinkWebAuthnRequest);
            Assert.Equal(HttpStatusCode.Unauthorized, result.StatusCode);
        }
        Assert.Null(await factory.Services.GetRequiredService<IAccountStore>().FindByIdAsync(verify.AccountId, CancellationToken.None));
        Assert.NotNull(await factory.Services.GetRequiredService<IAnonymousPatientAccessStore>().FindInvitationAsync(code, CancellationToken.None));
    }

    [Theory]
    [InlineData("/auth/magic-link/request")]
    [InlineData("/auth/magic-link/_debug-last")]
    public async Task ObsoletePatientEmailRoutes_AreNotMapped(string path)
    {
        using var factory = Factory();
        using var client = factory.CreateClient();
        var response = path.EndsWith("request", StringComparison.Ordinal)
            ? await client.PostAsync(path, new StringContent("{\"email\":\"forbidden@example.test\"}", Encoding.UTF8, "application/json"))
            : await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
