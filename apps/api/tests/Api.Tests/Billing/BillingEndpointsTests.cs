using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Api.Billing;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;

namespace Api.Tests.Billing;

/// <summary>
/// POST /webhooks/abacatepay ponta a ponta (forma S12-01, fatia 7): assinatura, tamanho do
/// corpo, forma do JSON, e -- critério de aceite 3 -- os MESMOS bytes postados duas vezes
/// devolvem duplicate:false depois duplicate:true, com uma única linha na tabela.
/// </summary>
[Collection("Database")]
public sealed class BillingEndpointsTests
{
    private const string WebhookSecret = "whsec_test123";

    private readonly PostgresContainerFixture _fixture;

    public BillingEndpointsTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task PostWebhook_ContentLengthOverLimit_Returns400()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var oversized = new byte[(64 * 1024) + 1];

        var response = await PostRawAsync(client, oversized, signature: null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostWebhook_WrongSignature_Returns401WithEmptyBody()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var body = AbacatePayFixtures.ReadBytes("webhook-checkout-completed.json");

        var response = await PostRawAsync(client, body, "wrong-signature-not-base64-hmac");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task PostWebhook_ValidSignatureButNotJson_Returns400()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var body = "not json"u8.ToArray();

        var response = await PostRawAsync(client, body, ValidSignature(body));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostWebhook_ValidSignatureButJsonNull_Returns400()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var body = "null"u8.ToArray();

        var response = await PostRawAsync(client, body, ValidSignature(body));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>Critério de aceite 3.</summary>
    [Fact]
    public async Task PostWebhook_SameBytesTwice_SecondIsDuplicateAndOnlyOneRowExists()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var body = AbacatePayFixtures.ReadBytes("webhook-checkout-completed.json");
        var signature = ValidSignature(body);

        var first = await PostRawAsync(client, body, signature);
        var second = await PostRawAsync(client, body, signature);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        using var firstDoc = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
        Assert.True(firstDoc.RootElement.GetProperty("received").GetBoolean());
        Assert.False(firstDoc.RootElement.GetProperty("duplicate").GetBoolean());

        using var secondDoc = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
        Assert.True(secondDoc.RootElement.GetProperty("received").GetBoolean());
        Assert.True(secondDoc.RootElement.GetProperty("duplicate").GetBoolean());

        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var countCommand = connection.CreateCommand();
        countCommand.CommandText = "SELECT COUNT(*) FROM abacatepay_webhook_events WHERE event_id = @id";
        countCommand.Parameters.AddWithValue("id", "log_abc123xyz");
        var rowCount = (long)(await countCommand.ExecuteScalarAsync())!;
        Assert.Equal(1, rowCount);
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", _fixture.AppRoleConnectionString);
                builder.UseSetting("StaffAccess:ApiKey", "test-staff-api-key");
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
                builder.UseSetting("AbacatePay:WebhookSecret", WebhookSecret);
            });

    private static async Task<HttpResponseMessage> PostRawAsync(HttpClient client, byte[] body, string? signature)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post, $"/webhooks/abacatepay?webhookSecret={Uri.EscapeDataString(WebhookSecret)}")
        {
            Content = new ByteArrayContent(body),
        };
        if (signature is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Webhook-Signature", signature);
        }

        return await client.SendAsync(request);
    }

    private static string ValidSignature(byte[] body) =>
        Convert.ToBase64String(HMACSHA256.HashData(Encoding.UTF8.GetBytes(AbacatePayWebhookSignature.PublicKey), body));
}
