using System.Net.WebSockets;
using System.Text.Json;
using Api.Accounts;
using Api.Patients;
using Api.Problems;
using static Api.Problems.ProblemResults;

namespace Api.OnlineSessions;

public static class OnlineSessionEndpoints
{
    public static void AddOnlineSessions(this IServiceCollection services)
    {
        services.AddSingleton<OnlineSessionStore>();
        services.ConfigureHttpJsonOptions(options => options.SerializerOptions.TypeInfoResolverChain.Insert(0, OnlineSessionsJsonContext.Default));
    }

    private static OnlineIceServer[] IceServers(IConfiguration configuration) => configuration.GetSection("OnlineSessions:IceServers").GetChildren()
        .Select(section => new OnlineIceServer(section.GetSection("Urls").GetChildren().Select(url => url.Value!).ToArray(),
            section["Username"], section["Credential"])).ToArray();

    public static void MapOnlineSessions(this IEndpointRouteBuilder routes)
    {
        routes.MapPost("/accounts/{accountId:guid}/patients/{patientId:guid}/online-sessions", CreateAsync);
        routes.MapDelete("/accounts/{accountId:guid}/online-sessions/{roomId:guid}", EndAsync);
        routes.MapGet("/online-sessions/{roomId:guid}/signal", SignalAsync);
    }

    private static async Task<IResult> CreateAsync(Guid accountId, Guid patientId, IAccountStore accounts,
        PatientRecordStore records, OnlineSessionStore rooms, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(accountId, cancellationToken);
        if (account is null) return ProblemJson(404, "Account not found", AccountsProblemCodes.AuthAccountNotFound);
        if (!AccountAuthorizationGuard.CanCreatePatientRecords(account)) return ProblemJson(403, "Not authorized", "link.not_authorized");
        if (await records.GetLastSequenceAsync(accountId, patientId, cancellationToken) is null)
            return ProblemJson(404, "Patient record not found", PatientsProblemCodes.PatientsNotFound);
        var room = rooms.Create(accountId, patientId);
        if (room is null) return ProblemJson(503, "Online session capacity exhausted", "unexpected_error");
        return TypedResults.Created($"/online-sessions/{room.Id}/signal",
            new OnlineSessionInvite(room.Id, room.ProfessionalToken, room.PatientToken, room.ExpiresAt));
    }

    private static byte[] Encode(OnlineServerSignal signal) => JsonSerializer.SerializeToUtf8Bytes(signal, OnlineSessionsJsonContext.Default.OnlineServerSignal);

    private static async Task<IResult> EndAsync(Guid accountId, Guid roomId, OnlineSessionStore rooms, CancellationToken cancellationToken)
    {
        var room = rooms.Find(roomId);
        if (room is null || room.ProfessionalId != accountId) return ProblemJson(404, "Session invitation not found", "link.invite_not_found");
        room.BeginEnd();
        try
        {
            await room.SendAsync(0, Encode(new("ended")), cancellationToken);
            await room.SendAsync(1, Encode(new("ended")), cancellationToken);
        }
        catch (WebSocketException) { }
        finally { rooms.Close(room); }
        return TypedResults.NoContent();
    }

    private static async Task<byte[]?> ReadAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[65536];
        var length = 0;
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer.AsMemory(length), cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            if (result.MessageType != WebSocketMessageType.Text) throw new InvalidDataException("Text signaling required");
            length += result.Count;
            if (result.EndOfMessage) return buffer[..length];
            if (length == buffer.Length) throw new InvalidDataException("Signaling message too large");
        }
    }

    private static bool Valid(OnlineClientSignal signal, int participant) => signal.Type switch
    {
        "offer" => participant == 0 && signal.Sdp is { Length: > 0 } && signal.Candidate is null,
        "answer" => participant == 1 && signal.Sdp is { Length: > 0 } && signal.Candidate is null,
        "ice" => signal.Sdp is null && signal.Candidate is { Candidate.Length: <= 2048 } candidate &&
            (candidate.SdpMLineIndex is >= 0 and <= 16 || candidate.SdpMLineIndex is null && candidate.SdpMid is { Length: > 0 and <= 128 }),
        "end" or "ping" or "restart" => signal.Sdp is null && signal.Candidate is null,
        _ => false,
    };

    private static async Task SignalAsync(HttpContext context, Guid roomId, OnlineSessionStore rooms, IAccountStore accounts, IConfiguration configuration)
    {
        var room = rooms.Find(roomId);
        if (room is null || !context.WebSockets.IsWebSocketRequest) { context.Response.StatusCode = 404; return; }
        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        using var deadline = new CancellationTokenSource(room.ExpiresAt - DateTimeOffset.UtcNow);
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, room.Closed, deadline.Token);
        var participant = -1;
        try
        {
            using var handshake = CancellationTokenSource.CreateLinkedTokenSource(cancellation.Token);
            handshake.CancelAfter(TimeSpan.FromSeconds(10));
            var bytes = await ReadAsync(socket, handshake.Token);
            if (bytes is null) return;
            var authentication = JsonSerializer.Deserialize(bytes, OnlineSessionsJsonContext.Default.OnlineSessionAuthentication);
            var identity = authentication is { Token.Length: 64 } ? room.Authenticate(authentication.Token) : null;
            if (identity is null) throw new InvalidDataException("Invalid room capability");
            var account = await accounts.FindByIdAsync(room.ProfessionalId, cancellation.Token);
            if (account is null || !AccountAuthorizationGuard.CanCreatePatientRecords(account)) throw new InvalidDataException("Professional unavailable");
            if (!room.Join(identity.Value, socket, out var peerPresent)) throw new InvalidDataException("Participant already connected");
            participant = identity.Value;
            await room.SendAsync(participant, Encode(new("joined", participant == 0 ? "professional" : "patient", IceServers: IceServers(configuration))), cancellation.Token);
            if (peerPresent)
            {
                await room.SendAsync(0, Encode(new("peer-ready")), cancellation.Token);
                await room.SendAsync(1, Encode(new("peer-ready")), cancellation.Token);
            }
            while ((bytes = await ReadAsync(socket, cancellation.Token)) is not null)
            {
                var signal = JsonSerializer.Deserialize(bytes, OnlineSessionsJsonContext.Default.OnlineClientSignal);
                if (signal is null || !Valid(signal, participant)) throw new InvalidDataException("Invalid signaling message");
                if (signal.Type == "end")
                {
                    room.BeginEnd();
                    try
                    {
                        await room.SendAsync(0, Encode(new("ended")), cancellation.Token);
                        await room.SendAsync(1, Encode(new("ended")), cancellation.Token);
                    }
                    finally { rooms.Close(room); }
                    break;
                }
                if (signal.Type == "ping") await room.SendAsync(participant, Encode(new("pong")), cancellation.Token);
                else await room.SendAsync(1 - participant, Encode(new(signal.Type, Sdp: signal.Sdp, Candidate: signal.Candidate)), cancellation.Token);
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
        catch (Exception exception) when (exception is JsonException or InvalidDataException)
        {
            if (socket.State == WebSocketState.Open)
                await socket.CloseOutputAsync(WebSocketCloseStatus.PolicyViolation, "Invalid signaling", CancellationToken.None);
        }
        finally
        {
            if (participant >= 0)
            {
                room.Leave(participant, socket);
                if (!room.IsClosed)
                {
                    using var notification = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                    try { await room.SendAsync(1 - participant, Encode(new("peer-left")), notification.Token); }
                    catch (WebSocketException) { }
                    catch (OperationCanceledException) { }
                }
            }
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, room.IsClosed ? "Session ended" : "Participant left", CancellationToken.None);
        }
    }
}
