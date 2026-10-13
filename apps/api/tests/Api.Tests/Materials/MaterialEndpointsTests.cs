using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Api.Accounts;
using Api.Materials;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.Materials;

[Collection("Database")]
public sealed class MaterialEndpointsTests(PostgresContainerFixture fixture) : IAsyncLifetime
{
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
        builder.UseSetting("Totp:EncryptionKey", TotpTestEncryptionKey.Base64);
        builder.UseSetting("StaffAccess:ApiKey", "owned-test-staff-key");
        builder.UseSetting("AbacatePay:WebhookSecret", "owned-test-webhook-key");
        builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
        builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
    });

    private static async Task<(HttpClient Client, Guid Id)> ClientAsync(WebApplicationFactory<Program> factory,
        AccountRole role = AccountRole.Professional, AccountVerificationStatus status = AccountVerificationStatus.Active, bool exists = true)
    {
        var id = Guid.NewGuid();
        if (exists) await factory.Services.GetRequiredService<IAccountStore>().InsertAsync(new Account(id, role == AccountRole.Patient ? null : $"{id}@example.test", role, null, null, status), CancellationToken.None);
        var client = factory.CreateClient();
        var tokens = factory.Services.GetRequiredService<ISessionTokenIssuer>().IssuePair(id);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.AccessToken);
        return (client, id);
    }

    private static CreateMaterialRequest Material() => new(Guid.NewGuid(), new byte[60], new byte[28], new byte[29]);
    private static Task<HttpResponseMessage> Upload(HttpClient client, Guid owner, CreateMaterialRequest material) =>
        client.PostAsJsonAsync($"/accounts/{owner}/materials", material, MaterialsJsonContext.Default.CreateMaterialRequest);

    [Fact]
    public async Task RoundTrip_StoresOnlyCiphertextAndDeletesOwnedMaterial()
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var key = RandomNumberGenerator.GetBytes(32);
        var plaintext = Encoding.UTF8.GetBytes("PRIVATE-TITLE AND PRIVATE-PDF-CONTENT");
        var iv = RandomNumberGenerator.GetBytes(12);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(key, 16);
        aes.Encrypt(iv, plaintext, ciphertext, tag);
        var sealedBytes = iv.Concat(ciphertext).Concat(tag).ToArray();
        var material = Material() with { MetadataCiphertext = sealedBytes, ContentCiphertext = sealedBytes };
        var path = $"/accounts/{owner}/materials";
        Assert.Equal(HttpStatusCode.Created, (await Upload(client, owner, material)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Upload(client, owner, material)).StatusCode);
        var listed = await client.GetFromJsonAsync(path, MaterialsJsonContext.Default.MaterialList);
        var summary = Assert.Single(listed!.Materials);
        Assert.Equal(material.MaterialId, summary.MaterialId);
        Assert.Equal(material.WrappedDek, summary.WrappedDek);
        Assert.Equal(sealedBytes, summary.MetadataCiphertext);
        Assert.False(summary.Authorized);
        var content = await client.GetFromJsonAsync($"{path}/{material.MaterialId}/content", MaterialsJsonContext.Default.MaterialContent);
        Assert.Equal(sealedBytes, content!.ContentCiphertext);
        var reopened = new byte[plaintext.Length];
        aes.Decrypt(iv, content.ContentCiphertext.AsSpan(12, plaintext.Length), tag, reopened);
        Assert.Equal(plaintext, reopened);
        await using var connection = new NpgsqlConnection(fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT metadata_ciphertext, content_ciphertext FROM professional_materials WHERE material_id = @id";
        command.Parameters.AddWithValue("id", material.MaterialId);
        await using (var reader = await command.ExecuteReaderAsync())
        {
            Assert.True(await reader.ReadAsync());
            Assert.DoesNotContain("PRIVATE-TITLE", Encoding.UTF8.GetString((byte[])reader[0]));
            Assert.DoesNotContain("PRIVATE-PDF-CONTENT", Encoding.UTF8.GetString((byte[])reader[1]));
        }
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"{path}/{material.MaterialId}/authorization", new MaterialAuthorizationRequest(true), MaterialsJsonContext.Default.MaterialAuthorizationRequest)).StatusCode);
        listed = await client.GetFromJsonAsync(path, MaterialsJsonContext.Default.MaterialList);
        Assert.True(Assert.Single(listed!.Materials).Authorized);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"{path}/{material.MaterialId}/authorization", new MaterialAuthorizationRequest(false), MaterialsJsonContext.Default.MaterialAuthorizationRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"{path}/{material.MaterialId}")).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync(path, MaterialsJsonContext.Default.MaterialList))!.Materials);
    }

    [Fact]
    public async Task OtherProfessional_CannotReadAuthorizeDeleteOrListOwnedMaterial()
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var (other, stranger) = await ClientAsync(factory);
        using var otherHttp = other;
        var material = Material();
        await Upload(client, owner, material);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"/accounts/{owner}/materials")).StatusCode);
        var path = $"/accounts/{stranger}/materials";
        Assert.Empty((await other.GetFromJsonAsync(path, MaterialsJsonContext.Default.MaterialList))!.Materials);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"{path}/{material.MaterialId}/content")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync($"{path}/{material.MaterialId}/authorization", new MaterialAuthorizationRequest(true), MaterialsJsonContext.Default.MaterialAuthorizationRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"{path}/{material.MaterialId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/accounts/{owner}/materials/{material.MaterialId}/content")).StatusCode);
        using var unauthenticated = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await unauthenticated.GetAsync(path)).StatusCode);
    }

    [Theory]
    [InlineData(AccountRole.Patient, AccountVerificationStatus.Active, true, HttpStatusCode.Forbidden)]
    [InlineData(AccountRole.Professional, AccountVerificationStatus.Rejected, true, HttpStatusCode.Forbidden)]
    [InlineData(AccountRole.Professional, AccountVerificationStatus.Active, false, HttpStatusCode.NotFound)]
    public async Task EveryOperation_RequiresAnExistingActiveProfessional(AccountRole role, AccountVerificationStatus status, bool exists, HttpStatusCode expected)
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory, role, status, exists);
        using var http = client;
        var material = Material();
        var path = $"/accounts/{owner}/materials";
        Assert.Equal(expected, (await Upload(client, owner, material)).StatusCode);
        Assert.Equal(expected, (await client.GetAsync(path)).StatusCode);
        Assert.Equal(expected, (await client.GetAsync($"{path}/{material.MaterialId}/content")).StatusCode);
        Assert.Equal(expected, (await client.PutAsJsonAsync($"{path}/{material.MaterialId}/authorization", new MaterialAuthorizationRequest(true), MaterialsJsonContext.Default.MaterialAuthorizationRequest)).StatusCode);
        Assert.Equal(expected, (await client.DeleteAsync($"{path}/{material.MaterialId}")).StatusCode);
    }

    [Fact]
    public async Task InvalidIdentifiersAndCiphertextBounds_AreRejectedBeforeStorage()
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var valid = Material();
        foreach (var invalid in new[] {
            valid with { MaterialId = Guid.Empty }, valid with { WrappedDek = null! }, valid with { WrappedDek = new byte[59] },
            valid with { MetadataCiphertext = null! }, valid with { MetadataCiphertext = new byte[27] }, valid with { MetadataCiphertext = new byte[16385] },
            valid with { ContentCiphertext = null! }, valid with { ContentCiphertext = new byte[28] }, valid with { ContentCiphertext = new byte[20971549] }
        }) Assert.Equal(HttpStatusCode.BadRequest, (await Upload(client, owner, invalid)).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync($"/accounts/{owner}/materials", MaterialsJsonContext.Default.MaterialList))!.Materials);
    }
}
