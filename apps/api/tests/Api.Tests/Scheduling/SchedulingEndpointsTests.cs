using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Accounts;
using Api.Scheduling;
using Api.Scheduling;
using Api.Serialization;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.Scheduling;

/// <summary>
/// End-to-end round-trip against a real Postgres (Testcontainers) -- proves S04-02's three
/// acceptance criteria: exactly one winner under real concurrency for the same slot (1), no
/// plaintext column about the patient beyond the bare uuid (2), and a session with an active
/// recording can be neither moved nor cancelled (3).
/// </summary>
[Collection("Database")]
public sealed class SchedulingEndpointsTests : IAsyncLifetime
{
    private const string TestStaffApiKey = "test-staff-api-key";
    private const string ValidStubCode = "111111";

    private static readonly byte[] SomeVerifier = CreateVerifier(0x01);
    private static readonly DateTimeOffset SomeStart = new(2026, 3, 2, 14, 0, 0, TimeSpan.Zero);

    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public SchedulingEndpointsTests(PostgresContainerFixture fixture)
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

    /// <summary>
    /// Two truly concurrent requests for the same (tenant, starts_at) slot: exactly one wins,
    /// the other gets Failure(SlotTaken) -- decided by scheduled_sessions_live_slot_uq, not by
    /// application-level ordering. Same molde as PatientEndpointsTests's
    /// AppendEntryAsync_WithConcurrentRequestsForSameNextSequence_OnlyOneEverPersists.
    /// </summary>
    [Fact]
    public async Task ScheduleAsync_TwoConcurrentRequestsForSameSlot_OnlyOnePersists()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-concurrent@example.com");
        var schedulingService = factory.Services.GetRequiredService<SchedulingService>();

        var first = Task.Run(() => schedulingService.ScheduleAsync(accountId, Guid.NewGuid(), SomeStart, 50, CancellationToken.None));
        var second = Task.Run(() => schedulingService.ScheduleAsync(accountId, Guid.NewGuid(), SomeStart, 50, CancellationToken.None));
        var results = await Task.WhenAll(first, second);

        var winner = Assert.Single(results, r => r.Succeeded);
        Assert.Equal(accountId, winner.Session!.TenantId);
        var loser = Assert.Single(results, r => !r.Succeeded);
        Assert.Equal(SchedulingFailureReason.SlotTaken, loser.FailureReason);

        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var countCommand = connection.CreateCommand();
        countCommand.CommandText = "SELECT COUNT(*) FROM scheduled_sessions WHERE starts_at = @startsAt AND cancelled_at IS NULL";
        countCommand.Parameters.AddWithValue("startsAt", SomeStart);
        var rowCount = (long)(await countCommand.ExecuteScalarAsync())!;
        Assert.Equal(1, rowCount);
    }

    /// <summary>Fails if anyone ever adds a clear-text column about the person -- the acceptance criterion is "patient_id (uuid) is the only reference to the patient".</summary>
    [Fact]
    public async Task ScheduledSessions_HasNoPlaintextPatientColumn()
    {
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'scheduled_sessions'
            ORDER BY column_name
            """;

        var columns = new List<string>();
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                columns.Add(reader.GetString(0));
            }
        }

        Assert.Equal(
            new[] { "cancelled_at", "created_at", "duration_minutes", "id", "patient_id", "recording_active", "starts_at", "tenant_id" },
            columns);
    }

    [Fact]
    public async Task MoveSession_WithRecordingActive_Returns409_AndDoesNotMove()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-move-recording@example.com");
        var sessionId = await ScheduleSessionAsync(client, accountId, SomeStart, 50);
        await SetRecordingActiveAsync(sessionId);

        var response = await client.PatchAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions/{sessionId}",
            new MoveSessionRequest(SomeStart.AddHours(1), 30),
            SchedulingJsonContext.Default.MoveSessionRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("agenda.recording_active", doc.RootElement.GetProperty("code").GetString());

        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT starts_at FROM scheduled_sessions WHERE id = @id";
        command.Parameters.AddWithValue("id", sessionId);
        var storedStartsAt = (DateTime)(await command.ExecuteScalarAsync())!;
        Assert.Equal(SomeStart.UtcDateTime, storedStartsAt);
    }

    [Fact]
    public async Task CancelSession_WithRecordingActive_Returns409_AndCancelledAtStaysNull()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-cancel-recording@example.com");
        var sessionId = await ScheduleSessionAsync(client, accountId, SomeStart, 50);
        await SetRecordingActiveAsync(sessionId);

        var response = await client.DeleteAsync($"/accounts/{accountId}/agenda/sessions/{sessionId}");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("agenda.recording_active", doc.RootElement.GetProperty("code").GetString());

        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT cancelled_at FROM scheduled_sessions WHERE id = @id";
        command.Parameters.AddWithValue("id", sessionId);
        var cancelledAt = await command.ExecuteScalarAsync();
        Assert.True(cancelledAt is null or DBNull);
    }

    /// <summary>Proves the partial unique index only guards live rows -- cancelling frees the slot for a fresh schedule at the same instant.</summary>
    [Fact]
    public async Task CancelThenRescheduleSameSlot_Returns201()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-cancel-reschedule@example.com");
        var sessionId = await ScheduleSessionAsync(client, accountId, SomeStart, 50);

        var cancelResponse = await client.DeleteAsync($"/accounts/{accountId}/agenda/sessions/{sessionId}");
        Assert.Equal(HttpStatusCode.NoContent, cancelResponse.StatusCode);

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions",
            new ScheduleSessionRequest(Guid.NewGuid(), SomeStart, 45),
            SchedulingJsonContext.Default.ScheduleSessionRequest);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task MoveSession_OfAnotherTenant_Returns404()
    {
        using var factory = CreateFactory();
        using var clientA = factory.CreateClient();
        var accountIdA = await RegisterActiveProfessionalAsync(clientA, "sched-cross-tenant-a@example.com");
        var sessionId = await ScheduleSessionAsync(clientA, accountIdA, SomeStart, 50);

        using var clientB = factory.CreateClient();
        var accountIdB = await RegisterActiveProfessionalAsync(clientB, "sched-cross-tenant-b@example.com");

        var response = await clientB.PatchAsJsonAsync(
            $"/accounts/{accountIdB}/agenda/sessions/{sessionId}",
            new MoveSessionRequest(SomeStart.AddHours(1), 30),
            SchedulingJsonContext.Default.MoveSessionRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("agenda.session_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostScheduledSession_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/agenda/sessions",
            new ScheduleSessionRequest(Guid.NewGuid(), SomeStart, 50),
            SchedulingJsonContext.Default.ScheduleSessionRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostScheduledSession_WithUnverifiedProfessional_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalWithoutVerificationAsync(client, "sched-unverified@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions",
            new ScheduleSessionRequest(Guid.NewGuid(), SomeStart, 50),
            SchedulingJsonContext.Default.ScheduleSessionRequest);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("agenda.not_authorized_to_schedule", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostScheduledSession_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions",
            new ScheduleSessionRequest(Guid.NewGuid(), SomeStart, 50),
            SchedulingJsonContext.Default.ScheduleSessionRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostScheduledSession_WithDurationTooLow_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-duration-low@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions",
            new ScheduleSessionRequest(Guid.NewGuid(), SomeStart, 0),
            SchedulingJsonContext.Default.ScheduleSessionRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("durationMinutes", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostScheduledSession_WithDurationTooHigh_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-duration-high@example.com");

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions",
            new ScheduleSessionRequest(Guid.NewGuid(), SomeStart, 1441),
            SchedulingJsonContext.Default.ScheduleSessionRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("durationMinutes", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task PostScheduledSession_WithSlotAlreadyTaken_Returns409WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-slot-taken@example.com");
        await ScheduleSessionAsync(client, accountId, SomeStart, 50);

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions",
            new ScheduleSessionRequest(Guid.NewGuid(), SomeStart, 30),
            SchedulingJsonContext.Default.ScheduleSessionRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("agenda.slot_taken", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task PostScheduledSession_Succeeds_Returns201WithExpectedBody()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-create-success@example.com");
        var patientId = Guid.NewGuid();

        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions",
            new ScheduleSessionRequest(patientId, SomeStart, 50),
            SchedulingJsonContext.Default.ScheduleSessionRequest);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync(SchedulingJsonContext.Default.ScheduledSessionResponse);
        Assert.NotNull(created);
        Assert.Equal(patientId, created!.PatientId);
        Assert.Equal(SomeStart, created.StartsAt);
        Assert.Equal(50, created.DurationMinutes);
        Assert.Null(created.CancelledAt);
    }

    [Fact]
    public async Task MoveSession_ChangesStartsAtAndDuration_Returns200()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-move-success@example.com");
        var sessionId = await ScheduleSessionAsync(client, accountId, SomeStart, 50);
        var newStart = SomeStart.AddDays(1);

        var response = await client.PatchAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions/{sessionId}",
            new MoveSessionRequest(newStart, 30),
            SchedulingJsonContext.Default.MoveSessionRequest);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var moved = await response.Content.ReadFromJsonAsync(SchedulingJsonContext.Default.ScheduledSessionResponse);
        Assert.NotNull(moved);
        Assert.Equal(newStart, moved!.StartsAt);
        Assert.Equal(30, moved.DurationMinutes);
    }

    [Fact]
    public async Task MoveSession_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PatchAsJsonAsync(
            $"/accounts/{Guid.NewGuid()}/agenda/sessions/{Guid.NewGuid()}",
            new MoveSessionRequest(SomeStart, 50),
            SchedulingJsonContext.Default.MoveSessionRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task MoveSession_WithUnverifiedProfessional_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalWithoutVerificationAsync(client, "sched-move-unverified@example.com");

        var response = await client.PatchAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions/{Guid.NewGuid()}",
            new MoveSessionRequest(SomeStart, 50),
            SchedulingJsonContext.Default.MoveSessionRequest);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("agenda.not_authorized_to_schedule", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task MoveSession_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.PatchAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions/{Guid.NewGuid()}",
            new MoveSessionRequest(SomeStart, 50),
            SchedulingJsonContext.Default.MoveSessionRequest);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task MoveSession_WithDurationTooLow_Returns400WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-move-duration-low@example.com");
        var sessionId = await ScheduleSessionAsync(client, accountId, SomeStart, 50);

        var response = await client.PatchAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions/{sessionId}",
            new MoveSessionRequest(SomeStart.AddHours(1), 0),
            SchedulingJsonContext.Default.MoveSessionRequest);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("validation.invalid_field", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("durationMinutes", doc.RootElement.GetProperty("params").GetProperty("field").GetString());
    }

    [Fact]
    public async Task MoveSession_OfAlreadyCancelledSession_Returns409SessionCancelled()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-move-cancelled@example.com");
        var sessionId = await ScheduleSessionAsync(client, accountId, SomeStart, 50);
        await client.DeleteAsync($"/accounts/{accountId}/agenda/sessions/{sessionId}");

        var response = await client.PatchAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions/{sessionId}",
            new MoveSessionRequest(SomeStart.AddHours(1), 30),
            SchedulingJsonContext.Default.MoveSessionRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("agenda.session_cancelled", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task MoveSession_ToTakenSlot_Returns409SlotTaken()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-move-slot-taken@example.com");
        var takenSlot = SomeStart;
        await ScheduleSessionAsync(client, accountId, takenSlot, 50);
        var movableSessionId = await ScheduleSessionAsync(client, accountId, SomeStart.AddHours(2), 50);

        var response = await client.PatchAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions/{movableSessionId}",
            new MoveSessionRequest(takenSlot, 30),
            SchedulingJsonContext.Default.MoveSessionRequest);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("agenda.slot_taken", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task CancelSession_WithoutBearerToken_Returns401WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.DeleteAsync($"/accounts/{Guid.NewGuid()}/agenda/sessions/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.access_token_invalid", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task CancelSession_WithUnverifiedProfessional_Returns403WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterProfessionalWithoutVerificationAsync(client, "sched-cancel-unverified@example.com");

        var response = await client.DeleteAsync($"/accounts/{accountId}/agenda/sessions/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("agenda.not_authorized_to_schedule", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task CancelSession_WithUnknownAccountId_Returns404WithProblemDetails()
    {
        using var factory = CreateFactoryWithSessionBypass();
        using var client = factory.CreateClient();
        var accountId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accountId.ToString());

        var response = await client.DeleteAsync($"/accounts/{accountId}/agenda/sessions/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("auth.account_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task CancelSession_OfAnotherTenant_Returns404WithProblemDetails()
    {
        using var factory = CreateFactory();
        using var clientA = factory.CreateClient();
        var accountIdA = await RegisterActiveProfessionalAsync(clientA, "sched-cancel-cross-tenant-a@example.com");
        var sessionId = await ScheduleSessionAsync(clientA, accountIdA, SomeStart, 50);

        using var clientB = factory.CreateClient();
        var accountIdB = await RegisterActiveProfessionalAsync(clientB, "sched-cancel-cross-tenant-b@example.com");

        var response = await clientB.DeleteAsync($"/accounts/{accountIdB}/agenda/sessions/{sessionId}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("agenda.session_not_found", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task CancelSession_AlreadyCancelled_Returns409SessionCancelled()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-cancel-twice@example.com");
        var sessionId = await ScheduleSessionAsync(client, accountId, SomeStart, 50);
        await client.DeleteAsync($"/accounts/{accountId}/agenda/sessions/{sessionId}");

        var response = await client.DeleteAsync($"/accounts/{accountId}/agenda/sessions/{sessionId}");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("agenda.session_cancelled", doc.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task CancelSession_Succeeds_Returns204AndSetsCancelledAt()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var accountId = await RegisterActiveProfessionalAsync(client, "sched-cancel-success@example.com");
        var sessionId = await ScheduleSessionAsync(client, accountId, SomeStart, 50);

        var response = await client.DeleteAsync($"/accounts/{accountId}/agenda/sessions/{sessionId}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT cancelled_at FROM scheduled_sessions WHERE id = @id";
        command.Parameters.AddWithValue("id", sessionId);
        var cancelledAt = await command.ExecuteScalarAsync();
        Assert.False(cancelledAt is null or DBNull);
    }

    private static async Task<Guid> ScheduleSessionAsync(HttpClient client, Guid accountId, DateTimeOffset startsAt, int durationMinutes)
    {
        var response = await client.PostAsJsonAsync(
            $"/accounts/{accountId}/agenda/sessions",
            new ScheduleSessionRequest(Guid.NewGuid(), startsAt, durationMinutes),
            SchedulingJsonContext.Default.ScheduleSessionRequest);
        var created = await response.Content.ReadFromJsonAsync(SchedulingJsonContext.Default.ScheduledSessionResponse);
        return created!.SessionId;
    }

    /// <summary>
    /// Marks a session's recording as active directly via SQL -- there is no production writer
    /// nor <c>app_role</c> grant for recording_active yet (S05/S06), so this is the only way to
    /// reach that state in a test. Uses the admin connection, same as every other direct-SQL
    /// assertion in this file (e.g. the cancelled_at/starts_at reads above) -- not the
    /// tenant-scoped app_role primitive production code uses, since app_role deliberately has no
    /// UPDATE grant on this column (see migration 0004's least-privilege comment).
    /// </summary>
    private async Task SetRecordingActiveAsync(Guid sessionId)
    {
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE scheduled_sessions SET recording_active = true WHERE id = @id";
        command.Parameters.AddWithValue("id", sessionId);
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>Registers a Professional, completes TOTP enrollment, then submits a verified CRP credential so AccountVerificationStatus becomes Active -- same recipe as PatientEndpointsTests.</summary>
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

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", confirmed!.AccessToken);
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
                builder.ConfigureTestServices(services =>
                {
                    services.AddSingleton<ITotpProvider>(new StubTotpProvider());
                    services.AddSingleton<ICouncilRegistryVerifier>(new StubCouncilRegistryVerifier());
                });
            });

    private WebApplicationFactory<Program> CreateFactoryWithSessionBypass() =>
        CreateFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<ISessionTokenIssuer>(new AlwaysValidSessionTokenIssuer())));

    private sealed class AlwaysValidSessionTokenIssuer : ISessionTokenIssuer
    {
        public SessionTokenPair IssuePair(Guid accountId) => throw new NotSupportedException("not needed by the tests that use this stub");

        public RefreshSessionResult Refresh(string refreshToken) => throw new NotSupportedException("not needed by the tests that use this stub");

        public Guid? ValidateAccess(string accessToken) => Guid.TryParse(accessToken, out var accountId) ? accountId : null;
    }

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
}
