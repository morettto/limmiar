using System.Net.WebSockets;
using System.Security.Cryptography;

namespace Api.OnlineSessions;

public sealed class OnlineSessionRoom : IDisposable
{
    public OnlineSessionRoom(Guid professionalId, Guid patientId, DateTimeOffset expiresAt)
    {
        ProfessionalId = professionalId;
        PatientId = patientId;
        ExpiresAt = expiresAt;
        Closed = _lifetime.Token;
    }
    public Guid ProfessionalId { get; }
    public Guid PatientId { get; }
    public DateTimeOffset ExpiresAt { get; }
    public Guid Id { get; } = Guid.NewGuid();
    public string ProfessionalToken { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    public string PatientToken { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private readonly CancellationTokenSource _lifetime = new();
    private readonly WebSocket?[] _participants = new WebSocket?[2];
    private readonly SemaphoreSlim[] _sendLocks = [new(1), new(1)];
    private readonly object _gate = new();
    private bool _disposed;
    private volatile bool _ending;
    public CancellationToken Closed { get; }
    public bool IsClosed => _ending || Closed.IsCancellationRequested;

    public int? Authenticate(string token) => token == ProfessionalToken ? 0 : token == PatientToken ? 1 : null;

    public bool Join(int participant, WebSocket socket) => Join(participant, socket, out _);

    // Peer presence is read in the same lock as the join, so only the later participant announces peer-ready.
    public bool Join(int participant, WebSocket socket, out bool peerPresent)
    {
        lock (_gate)
        {
            peerPresent = false;
            if (IsClosed || _participants[participant] is not null) return false;
            _participants[participant] = socket;
            peerPresent = _participants[1 - participant] is not null;
            return true;
        }
    }
    public void Leave(int participant, WebSocket socket)
    {
        lock (_gate) { if (ReferenceEquals(_participants[participant], socket)) _participants[participant] = null; }
    }

    public async Task SendAsync(int participant, byte[] payload, CancellationToken cancellationToken)
    {
        await _sendLocks[participant].WaitAsync(cancellationToken);
        try
        {
            WebSocket? socket;
            lock (_gate) socket = _participants[participant];
            if (socket?.State == WebSocketState.Open)
                await socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
        }
        finally { _sendLocks[participant].Release(); }
    }

    public void Close() { lock (_gate) { if (!_disposed) _lifetime.Cancel(); } }
    public void BeginEnd() { lock (_gate) _ending = true; }
    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _lifetime.Cancel();
            _lifetime.Dispose();
        }
    }
}
