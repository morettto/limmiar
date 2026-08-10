using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Api.Accounts;

public sealed class DevicePairingIssuer : IDevicePairingIssuer
{
    public static readonly TimeSpan PairingSessionLifetime = TimeSpan.FromMinutes(2);

    private readonly Func<DateTimeOffset> _clock;
    private readonly TimeSpan _sessionLifetime;
    private readonly ConcurrentDictionary<string, PairingSessionRecord> _sessions = new(StringComparer.Ordinal);

    public DevicePairingIssuer(Func<DateTimeOffset>? clock = null, TimeSpan? sessionLifetime = null)
    {
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _sessionLifetime = sessionLifetime ?? PairingSessionLifetime;
    }

    public (string SessionId, DateTimeOffset ExpiresAt) Create(Guid accountId, byte[] primaryPublicKey)
    {
        var sessionId = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var expiresAt = _clock() + _sessionLifetime;
        _sessions[sessionId] = new PairingSessionRecord(accountId, primaryPublicKey, expiresAt);
        return (sessionId, expiresAt);
    }

    public ClaimPairingSessionResult Claim(string sessionId, byte[] newDevicePublicKey)
    {
        if (!TryGetLiveSession(sessionId, out var session) || session.Claimed)
        {
            return ClaimPairingSessionResult.Failure();
        }

        _sessions[sessionId] = session with { Claimed = true, NewDevicePublicKey = newDevicePublicKey };
        return ClaimPairingSessionResult.Success(session.PrimaryPublicKey);
    }

    public PairingClaimStatusResult GetClaimStatus(string sessionId, Guid accountId)
    {
        if (!TryGetLiveSession(sessionId, out var session) || session.AccountId != accountId)
        {
            return PairingClaimStatusResult.Failure();
        }

        return session.Claimed
            ? PairingClaimStatusResult.ClaimedBy(session.NewDevicePublicKey!)
            : PairingClaimStatusResult.Pending();
    }

    public SubmitPairingPayloadResult SubmitPayload(string sessionId, Guid accountId, byte[] encryptedKek)
    {
        if (!TryGetLiveSession(sessionId, out var session) || session.AccountId != accountId)
        {
            return SubmitPairingPayloadResult.Failure(SubmitPairingPayloadFailureReason.NotFound);
        }

        if (!session.Claimed)
        {
            return SubmitPairingPayloadResult.Failure(SubmitPairingPayloadFailureReason.NotClaimedYet);
        }

        if (session.EncryptedKek is not null)
        {
            return SubmitPairingPayloadResult.Failure(SubmitPairingPayloadFailureReason.AlreadySubmitted);
        }

        _sessions[sessionId] = session with { EncryptedKek = encryptedKek };
        return SubmitPairingPayloadResult.Success();
    }

    public FetchPairingPayloadResult FetchPayload(string sessionId)
    {
        if (!TryGetLiveSession(sessionId, out var session) || session.EncryptedKek is null)
        {
            return FetchPairingPayloadResult.Failure();
        }

        // Single retrieval: handing the ciphertext over ends the session outright.
        _sessions.TryRemove(sessionId, out _);
        return FetchPairingPayloadResult.Success(session.EncryptedKek);
    }

    private bool TryGetLiveSession(string sessionId, out PairingSessionRecord session)
    {
        if (!_sessions.TryGetValue(sessionId, out session))
        {
            return false;
        }

        if (session.ExpiresAt <= _clock())
        {
            _sessions.TryRemove(sessionId, out _);
            return false;
        }

        return true;
    }

    private readonly record struct PairingSessionRecord(
        Guid AccountId,
        byte[] PrimaryPublicKey,
        DateTimeOffset ExpiresAt,
        bool Claimed = false,
        byte[]? NewDevicePublicKey = null,
        byte[]? EncryptedKek = null);
}
