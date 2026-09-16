using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Api.Accounts;
using Api.Billing;
using Api.Platform;
using Api.Scheduling;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.Billing;

/// <summary>
/// POST /p/{token}/reserve ponta a ponta contra Postgres real (Testcontainers): o gémeo
/// transacional de SchedulingEndpointsTests.ScheduleAsync_TwoConcurrentRequestsForSameSlot.
/// </summary>
[Collection("Database")]
public sealed class PublicBookingEndpointsTests : IAsyncLifetime
{
    private const string TestStaffApiKey = "test-staff-api-key";
    private const string ValidStubCode = "111111";

    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);
    private static readonly DateTimeOffset SomeStart = new(2027, 4, 6, 14, 0, 0, TimeSpan.Zero);

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public PublicBookingEndpointsTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    public async Task InitializeAsync()
    {
        await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await adminConnection.OpenAsync();
        _respawner = await Respawner.CreateAsync(adminConnection, new RespawnerOptions
        {
            SchemasToInclude = ["public"],
            DbAdapter = DbAdapter.Postgres,
        });
        await _respawner.ResetAsync(adminConnection);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task ValidLink_Reserve_Returns201WithSession()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-basic@example.com");
        var token = await SeedLinkAsync(accountId, null);

        var response = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.NotEqual(Guid.Empty, doc.RootElement.GetProperty("sessionId").GetGuid());
    }

    /// <summary>Gémeo de SchedulingEndpointsTests:63 pelo endpoint público: dois links do mesmo
    /// tenant, mesmo horário, em corrida real -- exatamente um 201, o outro 409 slot_taken.</summary>
    [Fact]
    public async Task TwoLinksSameSlotConcurrently_One201One409AndOneRow()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-concurrent@example.com");
        var firstToken = await SeedLinkAsync(accountId, null);
        var secondToken = await SeedLinkAsync(accountId, null);

        var first = Task.Run(() => PostReserveAsync(client, firstToken, SomeStart, "Ana", "ana@example.com"));
        var second = Task.Run(() => PostReserveAsync(client, secondToken, SomeStart, "Bia", "bia@example.com"));
        var responses = await Task.WhenAll(first, second);

        Assert.Contains(responses, r => r.StatusCode == HttpStatusCode.Created);
        Assert.Contains(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        foreach (var response in responses)
        {
            response.Dispose();
        }

        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var countCommand = connection.CreateCommand();
        countCommand.CommandText = "SELECT COUNT(*) FROM scheduled_sessions WHERE starts_at = @startsAt AND cancelled_at IS NULL";
        countCommand.Parameters.AddWithValue("startsAt", SomeStart);
        Assert.Equal(1, (long)(await countCommand.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Reserve_WithEmptyName_Returns400()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-noname@example.com");
        var token = await SeedLinkAsync(accountId, null);

        var response = await PostReserveAsync(client, token, SomeStart, "", "x@example.com");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Reserve_WithEmptyContact_Returns400()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-nocontact@example.com");
        var token = await SeedLinkAsync(accountId, null);

        var response = await PostReserveAsync(client, token, SomeStart, "Maria", "  ");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Reserve_WithPastStartsAt_Returns400()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-past@example.com");
        var token = await SeedLinkAsync(accountId, null);

        var response = await PostReserveAsync(client, token, DateTimeOffset.UtcNow.AddHours(-1), "Maria", "maria@example.com");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Reserve_WithUnknownToken_Returns404()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await PostReserveAsync(client, PublicLinkToken.Generate(), SomeStart, "Maria", "maria@example.com");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("booking.link_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Reserve_WithLinkToUnknownAccount_Returns404()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var token = PublicLinkToken.Generate();
        await SeedHashAsync(PublicLinkTokenHash(token), Guid.NewGuid(), null);

        var response = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Reserve_WithExpiredLink_Returns404()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-expired@example.com");
        var token = await SeedLinkAsync(accountId, DateTimeOffset.UtcNow.AddHours(-1));

        var response = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("booking.link_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Reserve_Succeeds_Returns201WithCheckoutUrlAndOneEffectRow()
    {
        using var factory = CreateFactory();
        var fake = factory.Services.GetRequiredService<FakeAbacatePayClient>();
        fake.OnCreate = request => new Checkout("bill_test1", request.ExternalId, "https://pay.test/bill_test1", 10000, CheckoutStatus.Pending);
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-checkout@example.com");
        var token = await SeedLinkAsync(accountId, null);

        var response = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.NotEqual(Guid.Empty, doc.RootElement.GetProperty("sessionId").GetGuid());
        Assert.Equal("https://pay.test/bill_test1", doc.RootElement.GetProperty("checkoutUrl").GetString());
        Assert.NotNull(fake.LastCreateRequest);
        Assert.StartsWith("rsv_", fake.LastCreateRequest!.ExternalId);
        Assert.Equal("bill_test1", await EffectColumnAsync(fake.LastCreateRequest.ExternalId!, "checkout_id"));
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var countCommand = connection.CreateCommand();
        countCommand.CommandText = "SELECT COUNT(*) FROM booking_payments WHERE external_id = @e";
        countCommand.Parameters.AddWithValue("e", fake.LastCreateRequest.ExternalId!);
        Assert.Equal(1, (long)(await countCommand.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Reserve_SameBodyTwice_SecondIs200DedupedAndOneRow()
    {
        using var factory = CreateFactory();
        var fake = factory.Services.GetRequiredService<FakeAbacatePayClient>();
        fake.OnCreate = request => new Checkout("bill_test2", request.ExternalId, "https://pay.test/bill_test2", 5000, CheckoutStatus.Pending);
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-dedupe@example.com");
        var token = await SeedLinkAsync(accountId, null);

        var first = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");
        var second = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        using var firstDoc = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
        using var secondDoc = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
        Assert.Equal(
            firstDoc.RootElement.GetProperty("sessionId").GetGuid(),
            secondDoc.RootElement.GetProperty("sessionId").GetGuid());
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var countCommand = connection.CreateCommand();
        countCommand.CommandText = "SELECT COUNT(*) FROM booking_payments WHERE external_id = @e";
        countCommand.Parameters.AddWithValue("e", fake.LastCreateRequest!.ExternalId!);
        Assert.Equal(1, (long)(await countCommand.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Reserve_WhenCheckoutFails_Returns202WithEmptySession()
    {
        using var factory = CreateFactory();
        var fake = factory.Services.GetRequiredService<FakeAbacatePayClient>();
        fake.OnCreate = _ => AbacatePayFailureReason.Unavailable;
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-pending@example.com");
        var token = await SeedLinkAsync(accountId, null);

        var response = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(Guid.Empty, doc.RootElement.GetProperty("sessionId").GetGuid());
    }

    [Fact]
    public async Task Reserve_ConflictThenRetry_Returns409Then200DedupedWithEmptySession()
    {
        using var factory = CreateFactory();
        factory.Services.GetRequiredService<FakeAbacatePayClient>();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-retry@example.com");
        var occupy = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions",
            new ScheduleSessionRequest(Guid.NewGuid(), SomeStart, 50),
            SchedulingJsonContext.Default.ScheduleSessionRequest);
        Assert.Equal(HttpStatusCode.Created, occupy.StatusCode);
        var token = await SeedLinkAsync(accountId, null);

        var conflicted = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");
        var retried = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");

        Assert.Equal(HttpStatusCode.Conflict, conflicted.StatusCode);
        Assert.Equal(HttpStatusCode.OK, retried.StatusCode);
        using var doc = JsonDocument.Parse(await retried.Content.ReadAsStringAsync());
        Assert.Equal(Guid.Empty, doc.RootElement.GetProperty("sessionId").GetGuid());
    }

    [Fact]
    public async Task Webhook_PaidEventForKnownCheckout_MarksEffectPaid()
    {
        using var factory = CreateFactory();
        var fake = factory.Services.GetRequiredService<FakeAbacatePayClient>();
        fake.OnCreate = request => new Checkout("bill_paid_1", request.ExternalId, "https://pay.test/bill_paid_1", 10000, CheckoutStatus.Pending);
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-webhook@example.com");
        var token = await SeedLinkAsync(accountId, null);
        var reserved = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");
        Assert.Equal(HttpStatusCode.Created, reserved.StatusCode);

        var response = await PostWebhookAsync(client, WebhookJson($"log_{Guid.NewGuid():N}", "bill_paid_1", "PAID", 10000));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal((int)PaymentStatus.Paid, await EffectIntColumnAsync(fake.LastCreateRequest!.ExternalId!, "status"));
    }

    [Fact]
    public async Task Webhook_EventForUnknownCheckout_Returns200AndCreatesNoRow()
    {
        using var factory = CreateFactory();
        factory.Services.GetRequiredService<FakeAbacatePayClient>();
        using var client = factory.CreateClient();

        var response = await PostWebhookAsync(client, WebhookJson($"log_{Guid.NewGuid():N}", "bill_unknown", "PAID", 100));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var countCommand = connection.CreateCommand();
        countCommand.CommandText = "SELECT COUNT(*) FROM booking_payments WHERE checkout_id = @c";
        countCommand.Parameters.AddWithValue("c", "bill_unknown");
        Assert.Equal(0, (long)(await countCommand.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Reserve_ConflictWithPaidCheckout_RefundsExactlyOnceAcrossRedelivery()
    {
        using var factory = CreateFactory();
        var fake = factory.Services.GetRequiredService<FakeAbacatePayClient>();
        fake.OnCreate = request => new Checkout("bill_paid_9", request.ExternalId, "https://pay.test/bill_paid_9", 10000, CheckoutStatus.Paid);
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-refund@example.com");
        await ScheduleViaBearerAsync(client, accountId, SomeStart);
        var token = await SeedLinkAsync(accountId, null);

        var conflicted = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");

        Assert.Equal(HttpStatusCode.Conflict, conflicted.StatusCode);
        Assert.Equal(1, fake.RefundCalls);
        var externalId = fake.LastCreateRequest!.ExternalId!;
        Assert.Equal((int)PaymentStatus.Refunded, await EffectIntColumnAsync(externalId, "status"));

        var redelivery = await PostWebhookAsync(client, WebhookJson($"log_{Guid.NewGuid():N}", "bill_paid_9", "PAID", 10000));

        Assert.Equal(HttpStatusCode.OK, redelivery.StatusCode);
        Assert.Equal(1, fake.RefundCalls);
        Assert.Equal((int)PaymentStatus.Refunded, await EffectIntColumnAsync(externalId, "status"));
    }

    [Fact]
    public async Task Reserve_ConflictWithPaidButProviderHasNoRefund_Returns409AndKeepsPaid()
    {
        using var factory = CreateFactory();
        var fake = factory.Services.GetRequiredService<FakeAbacatePayClient>();
        fake.OnCreate = request => new Checkout("bill_paid_8", request.ExternalId, "https://pay.test/bill_paid_8", 10000, CheckoutStatus.Paid);
        fake.OnRefund = _ => RefundOutcome.ProviderHasNoRefund;
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-norefund@example.com");
        await ScheduleViaBearerAsync(client, accountId, SomeStart);
        var token = await SeedLinkAsync(accountId, null);

        var conflicted = await PostReserveAsync(client, token, SomeStart, "Maria", "maria@example.com");

        Assert.Equal(HttpStatusCode.Conflict, conflicted.StatusCode);
        Assert.Equal(1, fake.RefundCalls);
        Assert.Equal((int)PaymentStatus.Paid, await EffectIntColumnAsync(fake.LastCreateRequest!.ExternalId!, "status"));
    }

    [Fact]
    public async Task NoShow_FirstNoShow_Returns200Excused()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-noshow1@example.com");
        var sessionId = await ScheduleViaBearerAsync(client, accountId, SomeStart);

        var response = await client.PostAsync($"/sessions/{sessionId}/no-show", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("excused", doc.RootElement.GetProperty("verdict").GetString());
    }

    [Fact]
    public async Task NoShow_SecondNoShow_Returns200ForfeitsFee()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "pubbook-noshow2@example.com");
        var firstId = await ScheduleViaBearerAsync(client, accountId, SomeStart);
        var secondId = await ScheduleViaBearerAsync(client, accountId, SomeStart.AddHours(2));
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/sessions/{firstId}/no-show", null)).StatusCode);

        var response = await client.PostAsync($"/sessions/{secondId}/no-show", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("forfeitsFee", doc.RootElement.GetProperty("verdict").GetString());
    }

    [Fact]
    public async Task NoShow_UnknownSession_Returns404()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        await RegisterActiveProfessionalAsync(client, "pubbook-noshow3@example.com");

        var response = await client.PostAsync($"/sessions/{Guid.NewGuid()}/no-show", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("agenda.session_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task NoShow_OtherTenantSession_Returns404()
    {
        using var factory = CreateFactory();
        using var clientA = factory.CreateClient();
        var accountIdA = await RegisterActiveProfessionalAsync(clientA, "pubbook-noshow4a@example.com");
        var sessionId = await ScheduleViaBearerAsync(clientA, accountIdA, SomeStart);

        using var clientB = factory.CreateClient();
        await RegisterActiveProfessionalAsync(clientB, "pubbook-noshow4b@example.com");

        var response = await clientB.PostAsync($"/sessions/{sessionId}/no-show", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task NoShow_WithoutBearerToken_Returns401()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsync($"/sessions/{Guid.NewGuid()}/no-show", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task NoShow_WithInvalidToken_Returns401()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "nonsense");

        var response = await client.PostAsync($"/sessions/{Guid.NewGuid()}/no-show", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private static async Task<Guid> ScheduleViaBearerAsync(HttpClient client, Guid accountId, DateTimeOffset startsAt)
    {
        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions",
            new ScheduleSessionRequest(Guid.NewGuid(), startsAt, 50),
            SchedulingJsonContext.Default.ScheduleSessionRequest);
        var created = await response.Content.ReadFromJsonAsync(SchedulingJsonContext.Default.ScheduledSessionResponse);
        return created!.SessionId;
    }

    private static byte[] WebhookJson(string eventId, string checkoutId, string status, int amount) =>
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            id = eventId,
            @event = "checkout.completed",
            apiVersion = 2,
            devMode = false,
            data = new { id = checkoutId, externalId = "pedido-1", url = $"https://pay.test/{checkoutId}", amount, status },
        }));

    private static async Task<HttpResponseMessage> PostWebhookAsync(HttpClient client, byte[] body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/webhooks/abacatepay?webhookSecret=whsec_test123")
        {
            Content = new ByteArrayContent(body),
        };
        var signature = Convert.ToBase64String(
            System.Security.Cryptography.HMACSHA256.HashData(Encoding.UTF8.GetBytes(AbacatePayWebhookSignature.PublicKey), body));
        request.Headers.TryAddWithoutValidation("X-Webhook-Signature", signature);
        return await client.SendAsync(request);
    }

    private async Task<int> EffectIntColumnAsync(string externalId, string column)
    {
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {column} FROM booking_payments WHERE external_id = @e";
        command.Parameters.AddWithValue("e", externalId);
        return (int)(await command.ExecuteScalarAsync())!;
    }

    private async Task<string> EffectColumnAsync(string externalId, string column)
    {
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {column} FROM booking_payments WHERE external_id = @e";
        command.Parameters.AddWithValue("e", externalId);
        return (string)(await command.ExecuteScalarAsync())!;
    }

    private static async Task<HttpResponseMessage> PostReserveAsync(
        HttpClient client, string token, DateTimeOffset startsAt, string name, string contact)
    {
        var json = JsonSerializer.Serialize(new { startsAt, name, contact });
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        return await client.PostAsync($"/p/{token}/reserve", content);
    }

    /// <summary>Gera o token opaco (256 bits, base64url) e semeia o link por SQL admin,
    /// devolvendo o token em claro. O hash é reimplementado aqui de propósito: se a produção
    /// derivar outro hash, a semente não bate e o teste falha.</summary>
    private async Task<string> SeedLinkAsync(Guid tenantId, DateTimeOffset? expiresAt)
    {
        var token = PublicLinkToken.Generate();
        await SeedHashAsync(PublicLinkTokenHash(token), tenantId, expiresAt);
        return token;
    }

    private static string PublicLinkTokenHash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(token))).ToLowerInvariant();

    private async Task SeedHashAsync(string hash, Guid tenantId, DateTimeOffset? expiresAt)
    {
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO public_booking_links (token_hash, tenant_id, expires_at) VALUES (@hash, @tenant, @expires)";
        command.Parameters.AddWithValue("hash", hash);
        command.Parameters.AddWithValue("tenant", tenantId);
        command.Parameters.AddWithValue("expires", expiresAt.HasValue ? (object)expiresAt.Value : DBNull.Value);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<Guid> RegisterActiveProfessionalAsync(HttpClient client, string email)
    {
        var accountId = await RegisterProfessionalWithoutVerificationAsync(client, email);
        await client.PostAsJsonAsync(
            $"/accounts/{accountId}/professional-verification",
            new SubmitProfessionalCredentialRequest(ProfessionalCredentialType.Crp, "06/123456", "SP", null),
            AccountsJsonContext.Default.SubmitProfessionalCredentialRequest);
        return accountId;
    }

    private static async Task<Guid> RegisterProfessionalWithoutVerificationAsync(HttpClient client, string email)
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
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", confirmed!.AccessToken);
        return accountId;
    }

    private static byte[] CreateVerifier(byte fill)
    {
        var verifier = new byte[AccountVerifierLengths.PasswordVerifierLength];
        Array.Fill(verifier, fill);
        return verifier;
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:AppDb", _fixture.AppRoleConnectionString);
                builder.UseSetting("StaffAccess:ApiKey", TestStaffApiKey);
                builder.UseSetting("WebAuthn:RelyingPartyId", "limmiar.test");
                builder.UseSetting("WebAuthn:ExpectedOrigin", "https://limmiar.test");
                builder.UseSetting("AbacatePay:WebhookSecret", "whsec_test123");
                builder.UseSetting("AbacatePay:ApiKey", "test-abacate-key");
                builder.UseSetting("Totp:EncryptionKey", TotpTestEncryptionKey.Base64);
                builder.ConfigureTestServices(services =>
                {
                    services.AddSingleton<ITotpProvider>(new StubTotpProvider());
                    services.AddSingleton<ICouncilRegistryVerifier>(new StubCouncilRegistryVerifier());
                    var fake = new FakeAbacatePayClient();
                    services.AddSingleton(fake);
                    services.AddSingleton<IAbacatePayClient>(fake);
                });
            });

    private sealed class StubTotpProvider : ITotpProvider
    {
        public string GenerateSecret() => "STUBBEDSECRET";
        public string BuildProvisioningUri(string secret, string accountEmail, string issuer) =>
            $"otpauth://totp/{issuer}:{accountEmail}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30";
        public bool ValidateCode(string secret, string code, DateTimeOffset timestamp) => code == ValidStubCode;
    }

    private sealed class StubCouncilRegistryVerifier : ICouncilRegistryVerifier
    {
        public Task<CouncilRegistryVerificationResult> VerifyAsync(
            ProfessionalCredentialType type, string registryNumber, string registryUf, CancellationToken cancellationToken) =>
            Task.FromResult(CouncilRegistryVerificationResult.CreateVerified());
    }

    private sealed class FakeAbacatePayClient : IAbacatePayClient
    {
        public Func<CreateCheckoutRequest, Result<Checkout, AbacatePayFailureReason>>? OnCreate;
        public CreateCheckoutRequest? LastCreateRequest;
        public int RefundCalls;
        public Func<string, RefundOutcome>? OnRefund;

        public Task<Result<Checkout, AbacatePayFailureReason>> CreateCheckoutAsync(
            CreateCheckoutRequest request, CancellationToken cancellationToken)
        {
            LastCreateRequest = request;
            return Task.FromResult(OnCreate?.Invoke(request) ?? new Checkout("bill_default", request.ExternalId, "https://pay.test/bill_default", 10000, CheckoutStatus.Pending));
        }

        public Task<RefundOutcome> RefundAsync(string externalId, CancellationToken cancellationToken)
        {
            RefundCalls++;
            return Task.FromResult(OnRefund?.Invoke(externalId) ?? RefundOutcome.Refunded);
        }
    }
}
