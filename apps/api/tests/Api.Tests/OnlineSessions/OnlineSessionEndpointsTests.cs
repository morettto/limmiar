using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text.Json;
using Api.Accounts;
using Api.OnlineSessions;
using Api.Patients;
using Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;

namespace Api.Tests.OnlineSessions;

[Collection("Database")]
public sealed class OnlineSessionEndpointsTests(PostgresContainerFixture fixture) : IAsyncLifetime
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
        builder.UseSetting("Cors:AllowedOrigins:0", "https://limmiar.test");
        builder.UseSetting("OnlineSessions:IceServers:0:Urls:0", "turn:owned-test.invalid");
        builder.UseSetting("OnlineSessions:IceServers:0:Username", "opaque-turn-user");
        builder.UseSetting("OnlineSessions:IceServers:0:Credential", "test-credential");
    });

    private static async Task<(HttpClient Client, Account Account, Guid PatientId)> ProfessionalAsync(WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient();
        var account = new Account(Guid.NewGuid(), $"{Guid.NewGuid()}@example.test", AccountRole.Professional, null, null);
        await factory.Services.GetRequiredService<IAccountStore>().InsertAsync(account, CancellationToken.None);
        var token = factory.Services.GetRequiredService<ISessionTokenIssuer>().IssuePair(account.Id);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.AccessToken);
        var patientId = Guid.NewGuid();
        var record = await client.PostAsJsonAsync($"/accounts/{account.Id}/patients", new CreatePatientRequest(patientId, new byte[60], new byte[28]), PatientsJsonContext.Default.CreatePatientRequest);
        Assert.Equal(HttpStatusCode.Created, record.StatusCode);
        return (client, account, patientId);
    }

    private static async Task<OnlineSessionInvite> CreateAsync(HttpClient client, Guid accountId, Guid patientId)
    {
        var response = await client.PostAsync($"/accounts/{accountId}/patients/{patientId}/online-sessions", null);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync(OnlineSessionsJsonContext.Default.OnlineSessionInvite))!;
    }

    private static async Task SendAsync(WebSocket socket, object message, WebSocketMessageType type = WebSocketMessageType.Text, bool end = true) =>
        await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(message), type, end, CancellationToken.None);

    private static async Task<JsonElement> ReadAsync(WebSocket socket)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var bytes = new byte[65536];
        var read = await socket.ReceiveAsync(bytes.AsMemory(), deadline.Token);
        Assert.Equal(WebSocketMessageType.Text, read.MessageType);
        return JsonDocument.Parse(bytes.AsMemory(0, read.Count)).RootElement.Clone();
    }

    private static async Task<WebSocket> ConnectAsync(WebApplicationFactory<Program> factory, OnlineSessionInvite invite, string token)
    {
        var client = factory.Server.CreateWebSocketClient();
        client.ConfigureRequest = request => request.Headers.Origin = "https://limmiar.test";
        var socket = await client.ConnectAsync(new Uri($"ws://localhost/online-sessions/{invite.RoomId}/signal"), CancellationToken.None);
        await SendAsync(socket, new { token });
        return socket;
    }

    [Fact]
    public async Task Creation_RequiresOwnedRecordAndActiveProfessional()
    {
        using var factory = Factory();
        var (owner, account, patientId) = await ProfessionalAsync(factory);
        using var ownerClient = owner;
        var (other, otherAccount, _) = await ProfessionalAsync(factory);
        using var otherClient = other;
        var path = $"/accounts/{account.Id}/patients/{patientId}/online-sessions";
        Assert.Equal(HttpStatusCode.Forbidden, (await other.PostAsync(path, null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsync($"/accounts/{otherAccount.Id}/patients/{patientId}/online-sessions", null)).StatusCode);
        using var guest = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await guest.PostAsync(path, null)).StatusCode);
        await factory.Services.GetRequiredService<IAccountStore>().MutateAsync(account.Id, _ => account with { VerificationStatus = AccountVerificationStatus.Rejected }, CancellationToken.None);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PostAsync(path, null)).StatusCode);
    }

    [Fact]
    public async Task TwoParticipants_HaveFixedRolesRelayOnlyToPeerAndEndInvalidatesInvitation()
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var invite = await CreateAsync(client, account.Id, patientId);
        Assert.Equal(64, invite.PatientToken.Length);
        Assert.NotEqual(invite.ProfessionalToken, invite.PatientToken);
        Assert.Equal(patientId, factory.Services.GetRequiredService<OnlineSessionStore>().Find(invite.RoomId)!.PatientId);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/online-sessions/{invite.RoomId}/signal")).StatusCode);
        using var professional = await ConnectAsync(factory, invite, invite.ProfessionalToken);
        var joined = await ReadAsync(professional);
        Assert.Equal("professional", joined.GetProperty("role").GetString());
        Assert.Equal("opaque-turn-user", joined.GetProperty("iceServers")[0].GetProperty("username").GetString());
        using var patient = await ConnectAsync(factory, invite, invite.PatientToken);
        Assert.Equal("patient", (await ReadAsync(patient)).GetProperty("role").GetString());
        Assert.Equal("peer-ready", (await ReadAsync(patient)).GetProperty("type").GetString());
        Assert.Equal("peer-ready", (await ReadAsync(professional)).GetProperty("type").GetString());
        await SendAsync(professional, new { type = "offer", sdp = "owned-sdp" });
        Assert.Equal("owned-sdp", (await ReadAsync(patient)).GetProperty("sdp").GetString());
        await SendAsync(patient, new { type = "answer", sdp = "owned-answer" });
        Assert.Equal("owned-answer", (await ReadAsync(professional)).GetProperty("sdp").GetString());
        await SendAsync(patient, new { type = "ice", candidate = new { candidate = "candidate", sdpMid = "0", sdpMLineIndex = 0, usernameFragment = "random" } });
        Assert.Equal("ice", (await ReadAsync(professional)).GetProperty("type").GetString());
        await SendAsync(patient, new { type = "ice", candidate = new { candidate = "candidate", sdpMid = "0" } });
        Assert.Equal("ice", (await ReadAsync(professional)).GetProperty("type").GetString());
        await SendAsync(patient, new { type = "restart" });
        Assert.Equal("restart", (await ReadAsync(professional)).GetProperty("type").GetString());
        await SendAsync(professional, new { type = "ping" });
        Assert.Equal("pong", (await ReadAsync(professional)).GetProperty("type").GetString());
        await SendAsync(professional, new { type = "end" });
        Assert.Equal("ended", (await ReadAsync(patient)).GetProperty("type").GetString());
        Assert.Equal("ended", (await ReadAsync(professional)).GetProperty("type").GetString());
        Assert.Null(factory.Services.GetRequiredService<OnlineSessionStore>().Find(invite.RoomId));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/online-sessions/{invite.RoomId}/signal")).StatusCode);
    }

    [Fact]
    public async Task DuplicateParticipant_CannotDisplaceConnectedPeer()
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var invite = await CreateAsync(client, account.Id, patientId);
        using var professional = await ConnectAsync(factory, invite, invite.ProfessionalToken);
        await ReadAsync(professional);
        using var duplicate = await ConnectAsync(factory, invite, invite.ProfessionalToken);
        var frame = await duplicate.ReceiveAsync(new byte[128].AsMemory(), CancellationToken.None);
        Assert.Equal(WebSocketMessageType.Close, frame.MessageType);
        Assert.Equal(WebSocketCloseStatus.PolicyViolation, duplicate.CloseStatus);
        await SendAsync(professional, new { type = "ping" });
        Assert.Equal("pong", (await ReadAsync(professional)).GetProperty("type").GetString());
    }

    [Theory]
    [InlineData("{\"token\":\"unknown\"}")]
    [InlineData("null")]
    [InlineData("{\"token\":\"wrong\",\"email\":\"forbidden@example.test\"}")]
    public async Task InvalidAuthentication_IsRejectedWithoutParticipantLease(string payload)
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var invite = await CreateAsync(client, account.Id, patientId);
        using var socket = await factory.Server.CreateWebSocketClient().ConnectAsync(new Uri($"ws://localhost/online-sessions/{invite.RoomId}/signal"), CancellationToken.None);
        await socket.SendAsync(System.Text.Encoding.UTF8.GetBytes(payload), WebSocketMessageType.Text, true, CancellationToken.None);
        var read = await socket.ReceiveAsync(new byte[128].AsMemory(), CancellationToken.None);
        Assert.Equal(WebSocketMessageType.Close, read.MessageType);
        Assert.Equal(WebSocketCloseStatus.PolicyViolation, socket.CloseStatus);
        using var valid = await ConnectAsync(factory, invite, invite.PatientToken);
        Assert.Equal("patient", (await ReadAsync(valid)).GetProperty("role").GetString());
    }

    [Fact]
    public async Task Capabilities_AreRoomScopedAndOwnerAloneCanRevokeBeforeJoining()
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var (other, otherAccount, otherPatient) = await ProfessionalAsync(factory);
        using var otherHttp = other;
        var first = await CreateAsync(client, account.Id, patientId);
        var second = await CreateAsync(other, otherAccount.Id, otherPatient);
        using var crossRoom = await ConnectAsync(factory, second, first.PatientToken);
        var frame = await crossRoom.ReceiveAsync(new byte[128].AsMemory(), CancellationToken.None);
        Assert.Equal(WebSocketMessageType.Close, frame.MessageType);
        Assert.Equal(WebSocketCloseStatus.PolicyViolation, crossRoom.CloseStatus);
        Assert.Equal(HttpStatusCode.Forbidden, (await other.DeleteAsync($"/accounts/{account.Id}/online-sessions/{first.RoomId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"/accounts/{otherAccount.Id}/online-sessions/{first.RoomId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/accounts/{account.Id}/online-sessions/{first.RoomId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"/accounts/{account.Id}/online-sessions/{first.RoomId}")).StatusCode);
        using var patient = await ConnectAsync(factory, second, second.PatientToken);
        Assert.Equal("patient", (await ReadAsync(patient)).GetProperty("role").GetString());
    }

    [Theory]
    [InlineData("{\"type\":\"offer\",\"sdp\":\"forbidden\"}", false)]
    [InlineData("{\"type\":\"answer\",\"sdp\":\"forbidden\"}", true)]
    [InlineData("{\"type\":\"ice\",\"candidate\":{\"candidate\":\"candidate\",\"sdpMLineIndex\":-1}}", false)]
    [InlineData("{\"type\":\"ping\",\"email\":\"forbidden\"}", false)]
    [InlineData("null", false)]
    [InlineData("{\"type\":\"unknown\"}", false)]
    [InlineData("{\"type\":\"offer\",\"sdp\":\"\"}", true)]
    [InlineData("{\"type\":\"offer\"}", true)]
    [InlineData("{\"type\":\"offer\",\"sdp\":\"x\",\"candidate\":{\"candidate\":\"x\"}}", true)]
    [InlineData("{\"type\":\"answer\",\"sdp\":\"\"}", false)]
    [InlineData("{\"type\":\"answer\"}", false)]
    [InlineData("{\"type\":\"answer\",\"sdp\":\"x\",\"candidate\":{\"candidate\":\"x\"}}", false)]
    [InlineData("{\"type\":\"ice\"}", false)]
    [InlineData("{\"type\":\"ice\",\"sdp\":\"x\"}", false)]
    [InlineData("{\"type\":\"ice\",\"candidate\":{\"candidate\":\"x\",\"sdpMLineIndex\":17}}", false)]
    [InlineData("{\"type\":\"ice\",\"candidate\":{\"candidate\":\"x\"}}", false)]
    [InlineData("{\"type\":\"ice\",\"candidate\":{\"candidate\":\"x\",\"sdpMid\":\"\"}}", false)]
    [InlineData("{\"type\":\"end\",\"sdp\":\"x\"}", false)]
    [InlineData("{\"type\":\"ping\",\"candidate\":{\"candidate\":\"x\"}}", false)]
    public async Task UnknownFieldsAndWrongRoles_CannotRelay(string payload, bool professionalRole)
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var invite = await CreateAsync(client, account.Id, patientId);
        using var socket = await ConnectAsync(factory, invite, professionalRole ? invite.ProfessionalToken : invite.PatientToken);
        await ReadAsync(socket);
        await socket.SendAsync(System.Text.Encoding.UTF8.GetBytes(payload), WebSocketMessageType.Text, true, CancellationToken.None);
        var frame = await socket.ReceiveAsync(new byte[128].AsMemory(), CancellationToken.None);
        Assert.Equal(WebSocketMessageType.Close, frame.MessageType);
        Assert.Equal(WebSocketCloseStatus.PolicyViolation, socket.CloseStatus);
    }

    [Fact]
    public async Task DeletedProfessional_CannotAdmitPatientWithPreviouslyIssuedCapability()
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var invite = await CreateAsync(client, account.Id, patientId);
        await using (var admin = new NpgsqlConnection(fixture.AdminConnectionString))
        {
            await admin.OpenAsync();
            await using var truncate = new NpgsqlCommand("TRUNCATE accounts CASCADE", admin);
            await truncate.ExecuteNonQueryAsync();
        }
        using var socket = await ConnectAsync(factory, invite, invite.PatientToken);
        var frame = await socket.ReceiveAsync(new byte[128].AsMemory(), CancellationToken.None);
        Assert.Equal(WebSocketMessageType.Close, frame.MessageType);
        Assert.Equal(WebSocketCloseStatus.PolicyViolation, socket.CloseStatus);
    }

    [Fact]
    public async Task RevokedProfessional_CannotAdmitPatientWithPreviouslyIssuedCapability()
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var invite = await CreateAsync(client, account.Id, patientId);
        await factory.Services.GetRequiredService<IAccountStore>().MutateAsync(account.Id, _ => account with { VerificationStatus = AccountVerificationStatus.Rejected }, CancellationToken.None);
        using var socket = await ConnectAsync(factory, invite, invite.PatientToken);
        var frame = await socket.ReceiveAsync(new byte[128].AsMemory(), CancellationToken.None);
        Assert.Equal(WebSocketMessageType.Close, frame.MessageType);
        Assert.Equal(WebSocketCloseStatus.PolicyViolation, socket.CloseStatus);
    }

    [Fact]
    public void Expiration_CancelsRoomAndCapabilitiesDoNotSurviveClosure()
    {
        var now = DateTimeOffset.UtcNow;
        using var store = new OnlineSessionStore(() => now);
        var room = store.Create(Guid.NewGuid(), Guid.NewGuid())!;
        Assert.Same(room, store.Find(room.Id));
        now += OnlineSessionStore.Lifetime;
        Assert.Null(store.Find(room.Id));
        room.Dispose();
        Assert.True(room.Closed.IsCancellationRequested);
        using var socket = WebSocket.CreateFromStream(Stream.Null, true, null, TimeSpan.FromSeconds(30));
        Assert.False(room.Join(0, socket));
    }

    [Fact]
    public void Join_ReportsPeerOnlyToLaterParticipant()
    {
        using var store = new OnlineSessionStore(() => DateTimeOffset.UtcNow);
        var room = store.Create(Guid.NewGuid(), Guid.NewGuid())!;
        using var first = WebSocket.CreateFromStream(Stream.Null, true, null, TimeSpan.FromSeconds(30));
        using var second = WebSocket.CreateFromStream(Stream.Null, true, null, TimeSpan.FromSeconds(30));
        Assert.True(room.Join(1, first, out var firstSawPeer));
        Assert.True(room.Join(0, second, out var secondSawPeer));
        Assert.False(firstSawPeer);
        Assert.True(secondSawPeer);
    }

    [Fact]
    public async Task CloseFrame_ReleasesLeaseAndAllowsSameParticipantToReconnect()
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var invite = await CreateAsync(client, account.Id, patientId);
        using var professional = await ConnectAsync(factory, invite, invite.ProfessionalToken);
        await ReadAsync(professional);
        using var patient = await ConnectAsync(factory, invite, invite.PatientToken);
        await ReadAsync(patient); await ReadAsync(patient); await ReadAsync(professional);
        await patient.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Owned test leaving", CancellationToken.None);
        Assert.Equal("peer-left", (await ReadAsync(professional)).GetProperty("type").GetString());
        using var reconnected = await ConnectAsync(factory, invite, invite.PatientToken);
        Assert.Equal("patient", (await ReadAsync(reconnected)).GetProperty("role").GetString());
        await ReadAsync(reconnected); await ReadAsync(professional);
        var response = await client.DeleteAsync($"/accounts/{account.Id}/online-sessions/{invite.RoomId}");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal("ended", (await ReadAsync(professional)).GetProperty("type").GetString());
        Assert.Equal("ended", (await ReadAsync(reconnected)).GetProperty("type").GetString());
    }

    [Theory]
    [InlineData("binary")]
    [InlineData("oversize")]
    [InlineData("empty-handshake")]
    [InlineData("fragmented-handshake")]
    [InlineData("cancelled")]
    public async Task Frames_RejectAudioAndOversizeAndCleanUpHandshake(string kind)
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var invite = await CreateAsync(client, account.Id, patientId);
        using var socket = await factory.Server.CreateWebSocketClient().ConnectAsync(new Uri($"ws://localhost/online-sessions/{invite.RoomId}/signal"), CancellationToken.None);
        if (kind == "binary") await socket.SendAsync(new byte[16], WebSocketMessageType.Binary, true, CancellationToken.None);
        if (kind == "oversize") await socket.SendAsync(new byte[65536], WebSocketMessageType.Text, false, CancellationToken.None);
        if (kind == "empty-handshake") await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Leaving before authentication", CancellationToken.None);
        if (kind == "cancelled") factory.Services.GetRequiredService<OnlineSessionStore>().Close(factory.Services.GetRequiredService<OnlineSessionStore>().Find(invite.RoomId)!);
        if (kind == "fragmented-handshake")
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(new { token = invite.PatientToken });
            await socket.SendAsync(bytes.AsMemory(0, 20), WebSocketMessageType.Text, false, CancellationToken.None);
            await socket.SendAsync(bytes.AsMemory(20), WebSocketMessageType.Text, true, CancellationToken.None);
            Assert.Equal("patient", (await ReadAsync(socket)).GetProperty("role").GetString());
            await SendAsync(socket, new { type = "end" });
            Assert.Equal("ended", (await ReadAsync(socket)).GetProperty("type").GetString());
            return;
        }
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var frame = await socket.ReceiveAsync(new byte[128].AsMemory(), deadline.Token);
        Assert.Equal(WebSocketMessageType.Close, frame.MessageType);
        Assert.Equal(kind is "binary" or "oversize" ? WebSocketCloseStatus.PolicyViolation : WebSocketCloseStatus.NormalClosure, socket.CloseStatus);
    }

    [Fact]
    public async Task Capacity_IsBoundedAndUnknownAccountDoesNotCreateRoom()
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var store = factory.Services.GetRequiredService<OnlineSessionStore>();
        for (var i = 0; i < 256; i++) Assert.NotNull(store.Create(account.Id, patientId));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsync($"/accounts/{account.Id}/patients/{patientId}/online-sessions", null)).StatusCode);
        var unknownId = Guid.NewGuid();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.Services.GetRequiredService<ISessionTokenIssuer>().IssuePair(unknownId).AccessToken);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"/accounts/{unknownId}/patients/{patientId}/online-sessions", null)).StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailedPeerNotification_ReleasesOwnLeaseAndDoesNotLeakExceptions(bool cancelled)
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var invite = await CreateAsync(client, account.Id, patientId);
        var room = factory.Services.GetRequiredService<OnlineSessionStore>().Find(invite.RoomId)!;
        using var failedPeer = new FailedSocket(cancelled);
        Assert.True(room.Join(1, failedPeer));
        using var professional = await ConnectAsync(factory, invite, invite.ProfessionalToken);
        Assert.Equal("joined", (await ReadAsync(professional)).GetProperty("type").GetString());
        Assert.Equal("peer-ready", (await ReadAsync(professional)).GetProperty("type").GetString());
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        Assert.Equal(WebSocketMessageType.Close, (await professional.ReceiveAsync(new byte[128].AsMemory(), deadline.Token)).MessageType);
        Assert.True(room.Join(0, failedPeer));
    }

    [Fact]
    public async Task End_RemovesCapabilityEvenWhenSocketIsAlreadyLost()
    {
        using var factory = Factory();
        var (client, account, patientId) = await ProfessionalAsync(factory);
        using var http = client;
        var invite = await CreateAsync(client, account.Id, patientId);
        var room = factory.Services.GetRequiredService<OnlineSessionStore>().Find(invite.RoomId)!;
        using var failed = new FailedSocket(false);
        Assert.True(room.Join(0, failed));
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/accounts/{account.Id}/online-sessions/{room.Id}")).StatusCode);
        Assert.True(room.Closed.IsCancellationRequested);
        Assert.Null(factory.Services.GetRequiredService<OnlineSessionStore>().Find(room.Id));
    }

    private sealed class FailedSocket(bool cancelled) : WebSocket
    {
        public override WebSocketCloseStatus? CloseStatus => null;
        public override string? CloseStatusDescription => null;
        public override WebSocketState State => WebSocketState.Open;
        public override string? SubProtocol => null;
        public override void Abort() { }
        public override void Dispose() { }
        public override Task CloseAsync(WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken) => Task.CompletedTask;
        public override Task CloseOutputAsync(WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken) => Task.CompletedTask;
        public override Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer, CancellationToken cancellationToken) => throw new NotSupportedException();
        public override Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType messageType, bool endOfMessage, CancellationToken cancellationToken) =>
            cancelled ? Task.FromCanceled(new CancellationToken(true)) : Task.FromException(new WebSocketException("Owned fixture lost connection"));
    }
}
