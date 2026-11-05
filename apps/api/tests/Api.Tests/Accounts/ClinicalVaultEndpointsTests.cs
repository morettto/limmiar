using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Api.Accounts;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.Accounts;

[Collection("Database")]
public sealed class ClinicalVaultEndpointsTests(PostgresContainerFixture fixture) : IAsyncLifetime
{
    public async Task InitializeAsync()
    {
        await using var connection = new NpgsqlConnection(fixture.AdminConnectionString);
        await connection.OpenAsync();
        var respawner = await Respawner.CreateAsync(connection, new RespawnerOptions { SchemasToInclude = ["public"], DbAdapter = DbAdapter.Postgres });
        await respawner.ResetAsync(connection);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task CreationIsOnce_OnlyOpaqueEnvelopesAreReturned_AndRecoveryVerifiersAreHashed()
    {
        using var factory = Factory();
        using var client = factory.CreateClient();
        var id = await Professional(client);
        var path = $"/accounts/{id}/clinical-vault";
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(path)).StatusCode);
        var vault = Document();
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync(path, vault)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(path, Document())).StatusCode);
        var response = await client.GetAsync(path);
        var json = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("verifier", json, StringComparison.OrdinalIgnoreCase);
        var actual = JsonSerializer.Deserialize<VaultDocument>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal(vault.KeyEnvelope, actual.KeyEnvelope);
        Assert.Equal(vault.Revision, actual.Revision);
        await using var connection = new NpgsqlConnection(fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT recovery_slots::text FROM clinical_vaults WHERE account_id = @id", connection);
        command.Parameters.AddWithValue("id", id);
        var stored = (string)(await command.ExecuteScalarAsync())!;
        Assert.Contains(Convert.ToBase64String(SHA256.HashData(vault.RecoverySlots[0].Verifier)), stored);
        Assert.DoesNotContain(Convert.ToBase64String(vault.RecoverySlots[0].Verifier), stored);
    }

    [Fact]
    public async Task RecoveryRequiresCodeAndCurrentRevision_AndOnlyOneConcurrentRequestWins()
    {
        using var factory = Factory();
        using var client = factory.CreateClient();
        var id = await Professional(client);
        var path = $"/accounts/{id}/clinical-vault";
        var vault = Document();
        await client.PostAsJsonAsync(path, vault);
        var slot = vault.RecoverySlots[0];
        var next = Document();
        var request = new RecoverVaultRequest(vault.Revision, slot.Id, slot.Verifier, next);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(path + "/recover", request with { RecoveryVerifier = new byte[32] })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(path + "/recover", request with { ExpectedRevision = Guid.NewGuid() })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(path + "/recover", request with { RecoveryId = Guid.NewGuid() })).StatusCode);
        var results = await Task.WhenAll(client.PostAsJsonAsync(path + "/recover", request), client.PostAsJsonAsync(path + "/recover", request));
        Assert.Single(results, response => response.StatusCode == HttpStatusCode.NoContent);
        Assert.Single(results, response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(path + "/recover", request with { ExpectedRevision = next.Revision, Document = Document() })).StatusCode);
        var current = await client.GetFromJsonAsync<VaultDocument>(path);
        Assert.Equal(next.Revision, current!.Revision);
    }

    [Fact]
    public async Task RoutesRejectMissingOrForeignSessions_AndRlsHidesRowsWithoutTenant()
    {
        using var factory = Factory();
        using var client = factory.CreateClient();
        var id = await Professional(client);
        var path = $"/accounts/{id}/clinical-vault";
        var vault = Document();
        await client.PostAsJsonAsync(path, vault);
        client.DefaultRequestHeaders.Authorization = null;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync(path, vault)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Guid.NewGuid().ToString());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(path + "/recover", new RecoverVaultRequest(vault.Revision, vault.RecoverySlots[0].Id, vault.RecoverySlots[0].Verifier, Document()))).StatusCode);
        await using var connection = new NpgsqlConnection(fixture.AppRoleConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT count(*) FROM clinical_vaults", connection);
        Assert.Equal(0L, await command.ExecuteScalarAsync());
    }

    [Fact]
    public async Task CreationRefusesToReplaceLegacyEncryptedData()
    {
        using var factory = Factory();
        using var client = factory.CreateClient();
        var id = await Professional(client);
        await using var connection = new NpgsqlConnection(fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            INSERT INTO patient_record_entries (tenant_id, patient_id, sequence, wrapped_dek, ciphertext)
            VALUES (@id, @patient, 1, @wrapped, @cipher)
            """, connection);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("patient", Guid.NewGuid());
        command.Parameters.AddWithValue("wrapped", new byte[60]);
        command.Parameters.AddWithValue("cipher", new byte[28]);
        await command.ExecuteNonQueryAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/accounts/{id}/clinical-vault", Document())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/accounts/{id}/clinical-vault")).StatusCode);
    }

    [Fact]
    public async Task InvalidShapesAndReusedRevisionAreRefused()
    {
        using var factory = Factory();
        using var client = factory.CreateClient();
        var id = await Professional(client);
        var path = $"/accounts/{id}/clinical-vault";
        var vault = Document();
        foreach (var invalid in new[] {
            vault with { Revision = Guid.Empty }, vault with { KeyEnvelope = new byte[59] },
            vault with { RecoverySlots = [] }, vault with { RecoverySlots = [vault.RecoverySlots[0], vault.RecoverySlots[0], vault.RecoverySlots[0]] },
            vault with { RecoverySlots = [new(Guid.Empty, new byte[60], new byte[32]), .. vault.RecoverySlots.Skip(1)] },
            vault with { RecoverySlots = [new(Guid.NewGuid(), new byte[61], new byte[32]), .. vault.RecoverySlots.Skip(1)] },
            vault with { RecoverySlots = [new(Guid.NewGuid(), new byte[60], new byte[31]), .. vault.RecoverySlots.Skip(1)] } })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(path, invalid)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(path + "/recover", new RecoverVaultRequest(vault.Revision, Guid.NewGuid(), new byte[32], vault))).StatusCode);
    }

    [Fact]
    public async Task CreationRequiresAnExistingProfessionalAccount()
    {
        using var factory = Factory();
        using var client = factory.CreateClient();
        var missing = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", missing.ToString());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync($"/accounts/{missing}/clinical-vault", Document())).StatusCode);
        var patient = Guid.NewGuid();
        await factory.Services.GetRequiredService<IAccountStore>().InsertAsync(new Account(patient, null, AccountRole.Patient, null, null, AccountVerificationStatus.Active), CancellationToken.None);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", patient.ToString());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync($"/accounts/{patient}/clinical-vault", Document())).StatusCode);
    }

    [Fact]
    public async Task RecoveryRejectsInvalidRevisionIdentifierAndVerifierBeforeChangingVault()
    {
        using var factory = Factory();
        using var client = factory.CreateClient();
        var owner = await Professional(client);
        var path = $"/accounts/{owner}/clinical-vault";
        var current = Document();
        await client.PostAsJsonAsync(path, current);
        var valid = new RecoverVaultRequest(current.Revision, current.RecoverySlots[0].Id, current.RecoverySlots[0].Verifier, Document());
        foreach (var request in new[] {
            valid with { Document = Document() with { Revision = Guid.Empty } },
            valid with { ExpectedRevision = Guid.Empty }, valid with { RecoveryId = Guid.Empty },
            valid with { RecoveryVerifier = null! }, valid with { RecoveryVerifier = new byte[31] },
            valid with { Document = Document() with { Revision = current.Revision } } })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(path + "/recover", request)).StatusCode);
        Assert.Equal(current.Revision, (await client.GetFromJsonAsync<VaultDocument>(path))!.Revision);
    }

    private static VaultWrite Document() => new(Guid.NewGuid(), RandomNumberGenerator.GetBytes(60),
        Enumerable.Range(0, 3).Select(_ => new VaultRecoverySlotWrite(Guid.NewGuid(), RandomNumberGenerator.GetBytes(60), RandomNumberGenerator.GetBytes(32))).ToArray());

    private static async Task<Guid> Professional(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/auth/register", new RegisterRequest($"{Guid.NewGuid()}@example.test", new byte[32], AccountRole.Professional));
        response.EnsureSuccessStatusCode();
        var account = await response.Content.ReadFromJsonAsync<RegisterResponse>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", account!.Id.ToString());
        return account.Id;
    }

    private WebApplicationFactory<Program> Factory() => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
        builder.UseSetting("ConnectionStrings:AppDb", fixture.AppRoleConnectionString);
        builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
        builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
        builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
        builder.UseSetting("AbacatePay:WebhookSecret", "test-webhook");
        builder.UseSetting("AbacatePay:ApiKey", "test-api-key");
        builder.UseSetting("Totp:EncryptionKey", TotpTestEncryptionKey.Base64);
        builder.ConfigureTestServices(services => services.AddSingleton<ISessionTokenIssuer>(new TestSessions()));
    });

    private sealed class TestSessions : ISessionTokenIssuer
    {
        public AccessSession? ValidateAccess(string accessToken) => Guid.TryParse(accessToken, out var id) ? new AccessSession(id, id) : null;
        public SessionTokenPair IssuePair(Guid accountId) => throw new NotSupportedException();
        public RefreshSessionResult Refresh(string refreshToken) => throw new NotSupportedException();
        public AccessSession? Revoke(string refreshToken) => throw new NotSupportedException();
    }
}
