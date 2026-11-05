using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
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

    private readonly List<Guid> readyMaterials = [];

    private WebApplicationFactory<Program> Factory(Func<HttpRequestMessage, HttpResponseMessage>? readinessResponse = null, Func<HttpRequestMessage, Task<HttpResponseMessage>>? asynchronousReadinessResponse = null) => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
        builder.UseSetting("Copiloto:BaseUrl", "http://copiloto.test/");
        HttpResponseMessage DefaultReadiness(HttpRequestMessage _) => new(HttpStatusCode.OK)
        { Content = new StringContent(JsonSerializer.Serialize(new { materials = readyMaterials.Select(id => new { materialId = id, ready = true }) })) };
        Task<HttpResponseMessage> Respond(HttpRequestMessage request) => asynchronousReadinessResponse is not null
            ? asynchronousReadinessResponse(request) : Task.FromResult((readinessResponse ?? DefaultReadiness)(request));
        builder.ConfigureServices(services => services.AddHttpClient<MaterialReadiness>()
            .ConfigurePrimaryHttpMessageHandler(() => new ReadinessHandler(Respond)));
        builder.UseSetting("ConnectionStrings:AppDb", fixture.AppRoleConnectionString);
        builder.UseSetting("Totp:EncryptionKey", TotpTestEncryptionKey.Base64);
        builder.UseSetting("StaffAccess:ApiKey", "owned-test-staff-key");
        builder.UseSetting("AbacatePay:WebhookSecret", "owned-test-webhook-key");
        builder.UseSetting("AbacatePay:ApiKey", "test-abacate-key");
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

    private CreateMaterialRequest Material()
    {
        var id = Guid.NewGuid();
        readyMaterials.Add(id);
        return new(id, new byte[60], new byte[28], new byte[29]);
    }

    private sealed class ReadinessHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => response(request);
    }
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
    public async Task Usage_PersistsUntilExplicitReleaseAndBlocksDeleteAcrossSessions()
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var material = Material();
        await Upload(client, owner, material);
        var path = $"/accounts/{owner}/materials";
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        Task<HttpResponseMessage> Use(Guid session, Guid[] ids) => client.PutAsJsonAsync($"{path}/usage/{session}", new MaterialUsageRequest(ids), MaterialsJsonContext.Default.MaterialUsageRequest);
        Assert.Equal(HttpStatusCode.Conflict, (await Use(first, [material.MaterialId])).StatusCode);
        await client.PutAsJsonAsync($"{path}/{material.MaterialId}/authorization", new MaterialAuthorizationRequest(true), MaterialsJsonContext.Default.MaterialAuthorizationRequest);
        Assert.Equal(HttpStatusCode.NoContent, (await Use(first, [material.MaterialId])).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Use(second, [material.MaterialId])).StatusCode);
        Assert.True(Assert.Single((await client.GetFromJsonAsync(path, MaterialsJsonContext.Default.MaterialList))!.Materials).InUse);
        var blocked = await client.DeleteAsync($"{path}/{material.MaterialId}");
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        Assert.Contains("materials.in_use", await blocked.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NoContent, (await Use(first, [])).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"{path}/{material.MaterialId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Use(second, [])).StatusCode);
        Assert.False(Assert.Single((await client.GetFromJsonAsync(path, MaterialsJsonContext.Default.MaterialList))!.Materials).InUse);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"{path}/{material.MaterialId}")).StatusCode);
    }

    [Fact]
    public async Task Usage_RejectsOtherTenantsAndInvalidSelectionWithoutReleasingExistingReservations()
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var (other, stranger) = await ClientAsync(factory);
        using var otherHttp = other;
        var material = Material();
        await Upload(client, owner, material);
        var path = $"/accounts/{owner}/materials";
        var session = Guid.NewGuid();
        await client.PutAsJsonAsync($"{path}/{material.MaterialId}/authorization", new MaterialAuthorizationRequest(true), MaterialsJsonContext.Default.MaterialAuthorizationRequest);
        var request = new MaterialUsageRequest([material.MaterialId]);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"{path}/usage/{session}", request, MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync($"{path}/usage/{session}", request, MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync($"/accounts/{stranger}/materials/usage/{session}", request, MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync($"{path}/usage/{session}", new MaterialUsageRequest([Guid.NewGuid()]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"{path}/usage/{session}", new MaterialUsageRequest([material.MaterialId, material.MaterialId]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"{path}/{material.MaterialId}")).StatusCode);
    }

    [Fact]
    public async Task Usage_AddsSelectionsInSameSessionAndReleasesAllOnlyWhenExplicitlyEnded()
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var first = Material();
        var second = Material();
        var path = $"/accounts/{owner}/materials";
        var session = Guid.NewGuid();
        foreach (var material in new[] { first, second })
        {
            await Upload(client, owner, material);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"{path}/{material.MaterialId}/authorization", new MaterialAuthorizationRequest(true), MaterialsJsonContext.Default.MaterialAuthorizationRequest)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"{path}/usage/{session}", new MaterialUsageRequest([material.MaterialId]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"{path}/usage/{session}", new MaterialUsageRequest([second.MaterialId]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        var listed = await client.GetFromJsonAsync(path, MaterialsJsonContext.Default.MaterialList);
        Assert.Equal(2, listed!.Materials.Count);
        Assert.All(listed.Materials, material => Assert.True(material.InUse));
        foreach (var material in new[] { first, second })
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"{path}/{material.MaterialId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"{path}/usage/{session}", new MaterialUsageRequest([]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.All((await client.GetFromJsonAsync(path, MaterialsJsonContext.Default.MaterialList))!.Materials, material => Assert.False(material.InUse));
        foreach (var material in new[] { first, second })
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"{path}/{material.MaterialId}")).StatusCode);
    }

    [Fact]
    public async Task Captures_AnotherTabCannotCloseOrDeleteUntilEveryCaptureStops()
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var material = Material();
        await Upload(client, owner, material);
        var path = $"/accounts/{owner}/materials";
        var session = Guid.NewGuid();
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        await client.PutAsJsonAsync($"{path}/{material.MaterialId}/authorization", new MaterialAuthorizationRequest(true), MaterialsJsonContext.Default.MaterialAuthorizationRequest);
        foreach (var capture in new[] { first, second })
            Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"{path}/usage/{session}/captures/{capture}", new MaterialUsageRequest([material.MaterialId]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"{path}/usage/{session}", new MaterialUsageRequest([]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"{path}/usage/{session}/captures/{first}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"{path}/usage/{session}", new MaterialUsageRequest([]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"{path}/{material.MaterialId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"{path}/usage/{session}/captures/{second}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"{path}/usage/{session}", new MaterialUsageRequest([]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        var stale = await client.PutAsJsonAsync($"{path}/usage/{session}/captures/{Guid.NewGuid()}", new MaterialUsageRequest([material.MaterialId]), MaterialsJsonContext.Default.MaterialUsageRequest);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Contains("materials.session_closed", await stale.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"{path}/{material.MaterialId}")).StatusCode);
    }

    [Fact]
    public async Task Captures_AcquisitionRacingClosureIsAtomicAndTenantIsolated()
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var (other, stranger) = await ClientAsync(factory);
        using var otherHttp = other;
        var store = factory.Services.GetRequiredService<MaterialStore>();
        var session = Guid.NewGuid();
        var capture = Guid.NewGuid();
        Assert.Equal(MaterialMutation.Success, await store.SetUsageAsync(owner, session, [], CancellationToken.None, capture));
        Assert.Equal(HttpStatusCode.NoContent, (await other.DeleteAsync($"/accounts/{stranger}/materials/usage/{session}/captures/{capture}")).StatusCode);
        Assert.Equal(MaterialMutation.InUse, await store.SetUsageAsync(owner, session, [], CancellationToken.None));
        await store.ReleaseCaptureAsync(owner, session, capture, CancellationToken.None);
        for (var i = 0; i < 8; i++)
        {
            session = Guid.NewGuid();
            var start = store.SetUsageAsync(owner, session, [], CancellationToken.None, Guid.NewGuid());
            var close = store.SetUsageAsync(owner, session, [], CancellationToken.None);
            var results = await Task.WhenAll(start, close);
            Assert.True((results[0] == MaterialMutation.Success && results[1] == MaterialMutation.InUse)
                || (results[0] == MaterialMutation.SessionClosed && results[1] == MaterialMutation.Success));
        }
    }

    [Fact]
    public async Task Captures_ReleaseBeforeDelayedAcquisitionCannotResurrectCapture()
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var store = factory.Services.GetRequiredService<MaterialStore>();
        var session = Guid.NewGuid();
        var capture = Guid.NewGuid();
        await store.ReleaseCaptureAsync(owner, session, capture, CancellationToken.None);
        Assert.Equal(MaterialMutation.SessionClosed, await store.SetUsageAsync(owner, session, [], CancellationToken.None, capture));
        Assert.Equal(MaterialMutation.Success, await store.SetUsageAsync(owner, session, [], CancellationToken.None));
    }

    [Fact]
    public async Task Usage_AndDeleteRacingCannotDeleteAReservedMaterial()
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var store = factory.Services.GetRequiredService<MaterialStore>();
        for (var i = 0; i < 8; i++)
        {
            var material = Material();
            await store.CreateAsync(owner, material, CancellationToken.None);
            await store.SetAuthorizationAsync(owner, material.MaterialId, true, CancellationToken.None);
            var reservation = store.SetUsageAsync(owner, Guid.NewGuid(), [material.MaterialId], CancellationToken.None);
            var deletion = store.DeleteAsync(owner, material.MaterialId, CancellationToken.None);
            var results = await Task.WhenAll(reservation, deletion);
            Assert.True((results[0] == MaterialMutation.Success && results[1] == MaterialMutation.InUse)
                || (results[0] == MaterialMutation.NotFound && results[1] == MaterialMutation.Success));
        }
    }

    [Theory]
    [InlineData(false, HttpStatusCode.Conflict, "materials.not_prepared")]
    [InlineData(true, HttpStatusCode.ServiceUnavailable, "materials.readiness_unavailable")]
    public async Task Readiness_RejectsAuthorizationAndUsageButAllowsRevocationAndRelease(bool unavailable, HttpStatusCode expected, string code)
    {
        var reads = 0;
        Guid owner = default;
        using var factory = Factory(request =>
        {
            reads++;
            Assert.Equal($"http://copiloto.test/api/acervo/{owner}", request.RequestUri!.ToString());
            Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
            return new HttpResponseMessage(unavailable ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK)
            { Content = new StringContent("{\"materials\":[]}") };
        });
        var created = await ClientAsync(factory);
        owner = created.Id;
        using var client = created.Client;
        var material = Material();
        await Upload(client, owner, material);
        var path = $"/accounts/{owner}/materials";
        var authorization = await client.PutAsJsonAsync($"{path}/{material.MaterialId}/authorization", new MaterialAuthorizationRequest(true), MaterialsJsonContext.Default.MaterialAuthorizationRequest);
        Assert.Equal(expected, authorization.StatusCode);
        Assert.Contains(code, await authorization.Content.ReadAsStringAsync());
        var session = Guid.NewGuid();
        var usage = await client.PutAsJsonAsync($"{path}/usage/{session}", new MaterialUsageRequest([material.MaterialId]), MaterialsJsonContext.Default.MaterialUsageRequest);
        Assert.Equal(expected, usage.StatusCode);
        Assert.Contains(code, await usage.Content.ReadAsStringAsync());
        Assert.Equal(2, reads);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"{path}/{material.MaterialId}/authorization", new MaterialAuthorizationRequest(false), MaterialsJsonContext.Default.MaterialAuthorizationRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"{path}/usage/{session}", new MaterialUsageRequest([]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(2, reads);
        Assert.False(Assert.Single((await client.GetFromJsonAsync(path, MaterialsJsonContext.Default.MaterialList))!.Materials).Authorized);
    }

    [Fact]
    public async Task CaptureAndUsageRejectInvalidIdentifiersAndUnauthorizedRoles()
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var path = $"/accounts/{owner}/materials/usage";
        var session = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"{path}/{Guid.Empty}", new MaterialUsageRequest([]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"{path}/{session}/captures/{Guid.Empty}", new MaterialUsageRequest([]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        foreach (var ids in new Guid[][] { null!, [Guid.Empty], Enumerable.Range(0, 1001).Select(_ => Guid.NewGuid()).ToArray() })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"{path}/{session}", new MaterialUsageRequest(ids), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.DeleteAsync($"{path}/{Guid.Empty}/captures/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.DeleteAsync($"{path}/{session}/captures/{Guid.Empty}")).StatusCode);
        var (patient, patientId) = await ClientAsync(factory, AccountRole.Patient);
        using var patientHttp = patient;
        Assert.Equal(HttpStatusCode.Forbidden, (await patient.PutAsJsonAsync($"/accounts/{patientId}/materials/usage/{session}", new MaterialUsageRequest([]), MaterialsJsonContext.Default.MaterialUsageRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await patient.DeleteAsync($"/accounts/{patientId}/materials/usage/{session}/captures/{Guid.NewGuid()}")).StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task MaterialDeletedDuringReadinessCheckIsNotAuthorizedOrReserved(bool authorization)
    {
        Guid owner = default;
        CreateMaterialRequest material = Material();
        MaterialStore? store = null;
        using var factory = Factory(asynchronousReadinessResponse: async _ =>
        {
            Assert.Equal(MaterialMutation.Success, await store!.DeleteAsync(owner, material.MaterialId, CancellationToken.None));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(new { materials = new[] { new { materialId = material.MaterialId, ready = true } } })) };
        });
        var created = await ClientAsync(factory);
        owner = created.Id;
        using var client = created.Client;
        store = factory.Services.GetRequiredService<MaterialStore>();
        await Upload(client, owner, material);
        var path = $"/accounts/{owner}/materials";
        var response = authorization
            ? await client.PutAsJsonAsync($"{path}/{material.MaterialId}/authorization", new MaterialAuthorizationRequest(true), MaterialsJsonContext.Default.MaterialAuthorizationRequest)
            : await client.PutAsJsonAsync($"{path}/usage/{Guid.NewGuid()}", new MaterialUsageRequest([material.MaterialId]), MaterialsJsonContext.Default.MaterialUsageRequest);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync(path, MaterialsJsonContext.Default.MaterialList))!.Materials);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(59)]
    [InlineData(61)]
    public async Task MissingOrWrongSizeEncryptionKeyReturnsItsFieldAndStoresNothing(int length)
    {
        using var factory = Factory();
        var (client, owner) = await ClientAsync(factory);
        using var http = client;
        var material = Material() with { WrappedDek = length < 0 ? null! : new byte[length] };
        var response = await Upload(client, owner, material);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("wrappedDek", await response.Content.ReadAsStringAsync());
        Assert.Empty((await client.GetFromJsonAsync($"/accounts/{owner}/materials", MaterialsJsonContext.Default.MaterialList))!.Materials);
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
