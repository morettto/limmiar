using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Api.Accounts;
using Api.Audit;
using Api.Data;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.Audit;

/// <summary>
/// The audit trail wired end to end: real sessions as devices, SignIn on a session's first use,
/// ExportRequested inside its own export, SignOut on logout, and the periodic anchor.
/// </summary>
[Collection("Database")]
public sealed class AuditEndpointsTests : IAsyncLifetime
{
    private const string ValidStubCode = "111111";

    private readonly PostgresContainerFixture _fixture;
    private readonly List<NpgsqlDataSource> _dataSources = [];

    public AuditEndpointsTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    public async Task InitializeAsync()
    {
        await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await adminConnection.OpenAsync();
        var respawner = await Respawner.CreateAsync(adminConnection, new RespawnerOptions { SchemasToInclude = ["public"], DbAdapter = DbAdapter.Postgres });
        await respawner.ResetAsync(adminConnection);
    }

    public async Task DisposeAsync()
    {
        foreach (var dataSource in _dataSources)
        {
            await dataSource.DisposeAsync();
        }
    }

    [Fact]
    public async Task FirstUseOfSessionRecordsSignInAndExportRecordsItself()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "audit-trail@example.com");

        var trail = await GetTrailAsync(client, $"/accounts/{accountId}/audit");
        Assert.True(trail.Intact);
        Assert.Null(trail.FirstBrokenSequence);
        Assert.Equal([AuditAction.SignIn], trail.Entries.Select(e => e.Action));

        var export = await client.PostAsync($"/accounts/{accountId}/audit/exports", null);
        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
        var exported = (await export.Content.ReadFromJsonAsync(AuditJsonContext.Default.AuditTrailResponse))!;
        Assert.Equal([AuditAction.SignIn, AuditAction.ExportRequested], exported.Entries.Select(e => e.Action));
        Assert.Single(exported.Entries.Select(e => e.DeviceId).Distinct());
        Assert.Contains("\"action\":\"exportRequested\"", await export.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task DateFilterKeepsHalfOpenRange()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, _) = await RegisterAsync(client, "audit-filter@example.com");
        var agora = Uri.EscapeDataString(DateTimeOffset.UtcNow.AddMinutes(1).ToString("O"));
        var antes = Uri.EscapeDataString(DateTimeOffset.UtcNow.AddMinutes(-10).ToString("O"));

        Assert.Empty((await GetTrailAsync(client, $"/accounts/{accountId}/audit?from={agora}")).Entries);
        Assert.Empty((await GetTrailAsync(client, $"/accounts/{accountId}/audit?to={antes}")).Entries);
        Assert.Single((await GetTrailAsync(client, $"/accounts/{accountId}/audit?from={antes}&to={agora}")).Entries);
        Assert.Single((await GetTrailAsync(client, $"/accounts/{accountId}/audit?from={antes}")).Entries);
        Assert.Single((await GetTrailAsync(client, $"/accounts/{accountId}/audit?to={agora}")).Entries);
    }

    [Fact]
    public async Task LogoutRecordsSignOutForTheSameSession()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (accountId, refreshToken) = await RegisterAsync(client, "audit-logout@example.com");
        await GetTrailAsync(client, $"/accounts/{accountId}/audit");

        var logout = await client.PostAsJsonAsync("/auth/logout", new RefreshTokenRequest(refreshToken), AccountsJsonContext.Default.RefreshTokenRequest);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);

        var store = factory.Services.GetRequiredService<AuditEntryStore>();
        var chain = await store.ListAsync(accountId, CancellationToken.None);
        Assert.Equal([AuditAction.SignIn, AuditAction.SignOut], chain.Select(e => e.Action));
        Assert.Equal(chain[0].DeviceId, chain[1].DeviceId);
    }

    [Fact]
    public async Task RecorderAnchorsEveryFiftyEntries()
    {
        var store = new AuditEntryStore(CreateDataSource());
        var recorder = new AuditRecorder(store);
        var session = new AccessSession(Guid.NewGuid(), Guid.NewGuid());

        for (var i = 0; i < AuditRecorder.AnchorEvery; i++)
        {
            await recorder.RecordAsync(session, AuditAction.RecordOpened, CancellationToken.None);
            Assert.Equal(i + 1 == AuditRecorder.AnchorEvery ? 1 : 0, (await store.ListAnchorsAsync(session.AccountId, CancellationToken.None)).Count);
        }

        await recorder.RecordSignInOnceAsync(session, CancellationToken.None);
        await recorder.RecordSignInOnceAsync(session, CancellationToken.None);
        Assert.Equal(AuditRecorder.AnchorEvery + 1, (await store.ListAsync(session.AccountId, CancellationToken.None)).Count);
    }

    [Fact]
    public async Task RecorderFailsLoudlyWhenTheEntryIsLost()
    {
        var recorder = new AuditRecorder(new AuditEntryStore(CreateDataSource(), maxAttempts: 0));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            recorder.RecordAsync(new AccessSession(Guid.NewGuid(), Guid.NewGuid()), AuditAction.SignIn, CancellationToken.None));
    }

    private static async Task<AuditTrailResponse> GetTrailAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync(AuditJsonContext.Default.AuditTrailResponse))!;
    }

    private static async Task<(Guid AccountId, string RefreshToken)> RegisterAsync(HttpClient client, string email)
    {
        var verifier = new byte[AccountVerifierLengths.PasswordVerifierLength];
        Array.Fill(verifier, (byte)0x01);
        var registerResponse = await client.PostAsJsonAsync("/auth/register", new RegisterRequest(email, verifier, AccountRole.Professional),
            AccountsJsonContext.Default.RegisterRequest);
        var registered = (await registerResponse.Content.ReadFromJsonAsync(AccountsJsonContext.Default.RegisterResponse))!;
        var ticket = registered.TwoFactorTicket!;
        await client.PostAsJsonAsync($"/accounts/{registered.Id}/totp", new BeginTotpEnrollmentRequest(ticket),
            AccountsJsonContext.Default.BeginTotpEnrollmentRequest);
        var confirmResponse = await client.PostAsJsonAsync($"/accounts/{registered.Id}/totp/confirm",
            new ConfirmTotpEnrollmentRequest(ticket, ValidStubCode), AccountsJsonContext.Default.ConfirmTotpEnrollmentRequest);
        var confirmed = (await confirmResponse.Content.ReadFromJsonAsync(AccountsJsonContext.Default.ConfirmTotpEnrollmentResponse))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", confirmed.AccessToken);
        return (registered.Id, confirmed.RefreshToken);
    }

    private NpgsqlDataSource CreateDataSource()
    {
        var dataSource = NpgsqlDataSourceFactory.Create(_fixture.AppRoleConnectionString);
        _dataSources.Add(dataSource);
        return dataSource;
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:AppDb", _fixture.AppRoleConnectionString);
            builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
            builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
            builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
            builder.UseSetting("AbacatePay:WebhookSecret", "whsec_test123");
            builder.UseSetting("AbacatePay:ApiKey", "test-abacate-key");
            builder.UseSetting("Totp:EncryptionKey", TotpTestEncryptionKey.Base64);
            builder.ConfigureTestServices(services => services.AddSingleton<ITotpProvider>(new StubTotpProvider()));
        });

    private sealed class StubTotpProvider : ITotpProvider
    {
        public string GenerateSecret() => "STUBBEDSECRET";

        public string BuildProvisioningUri(string secret, string accountEmail, string issuer) =>
            $"otpauth://totp/{issuer}:{accountEmail}?secret={secret}&issuer={issuer}";

        public bool ValidateCode(string secret, string code, DateTimeOffset timestamp) => code == ValidStubCode;
    }
}
