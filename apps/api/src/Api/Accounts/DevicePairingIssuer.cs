using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Api.Accounts;

/// <summary>
/// In-memory <see cref="IDevicePairingIssuer"/> -- same placeholder fidelity as
/// <see cref="InMemoryAccountStore"/>/<see cref="TwoFactorTicketIssuer"/>/<see cref="SessionTokenIssuer"/>
/// (does not survive a process restart or work across multiple instances).
/// </summary>
public sealed class DevicePairingIssuer : IDevicePairingIssuer
{
    /// <summary>
    /// How long a pairing session stays open after <see cref="Create"/>. Two minutes is a
    /// product/security decision (a QR code on screen is meant to be scanned within
    /// seconds, and a short window bounds how long a photographed code stays useful) --
    /// it is not derived from any ADR, and is a single constant precisely so it can be
    /// retuned without touching the flow.
    /// </summary>
    public static readonly TimeSpan PairingSessionLifetime = TimeSpan.FromMinutes(2);

    private readonly Func<DateTimeOffset> _clock;
    private readonly TimeSpan _sessionLifetime;
    private readonly ConcurrentDictionary<string, PairingSessionRecord> _sessions = new(StringComparer.Ordinal);

    /// <param name="clock">
    /// Defaults to <see cref="DateTimeOffset.UtcNow"/>. Overridable so tests can prove
    /// expiry without a real <c>Thread.Sleep</c> -- same pattern as <see cref="TwoFactorTicketIssuer"/>.
    /// </param>
    /// <param name="sessionLifetime">
    /// Defaults to <see cref="PairingSessionLifetime"/>. Overridable ONLY so the E2E
    /// environment can configure a short-lived session (via Program.Composition.cs's
    /// <c>DevicePairing:SessionLifetimeSeconds</c>) and exercise a real "expired QR" scenario
    /// without a live two-minute wait -- production leaves this unset and gets
    /// <see cref="PairingSessionLifetime"/> untouched. Not exposed anywhere a real caller
    /// (as opposed to test/E2E composition) would set it.
    /// </param>
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

        // Reads only -- the record goes back untouched, so the primary can poll this as
        // often as it likes without burning either of the two single-use surfaces.
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

        // Single retrieval: handing the ciphertext over ends the session outright. Deleting
        // (rather than flagging it delivered and leaving the record to age out) is both the
        // payload-replay barrier and the reason the wrapped KEK does not sit in memory for
        // the rest of PairingSessionLifetime after the only party entitled to it has it.
        // Independent of the Claimed flag on purpose -- a claimed session is still very much
        // alive and mid-handshake; a fetched one is finished.
        _sessions.TryRemove(sessionId, out _);
        return FetchPairingPayloadResult.Success(session.EncryptedKek);
    }

    /// <summary>
    /// Single lookup point for every operation below <see cref="Create"/>: resolves
    /// <paramref name="sessionId"/> only if it exists AND has not expired, evicting it on
    /// the way out when it has (same lazy-eviction-on-read as
    /// <see cref="TwoFactorTicketIssuer.Validate"/> -- there is no sweeper).
    /// </summary>
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

    /// <summary>
    /// Immutable per-session record (same "reassign the dictionary slot instead of mutating
    /// a shared object" discipline as <see cref="SessionTokenIssuer"/>'s token records).
    /// </summary>
    private readonly record struct PairingSessionRecord(
        Guid AccountId,
        byte[] PrimaryPublicKey,
        DateTimeOffset ExpiresAt,
        bool Claimed = false,
        byte[]? NewDevicePublicKey = null,
        byte[]? EncryptedKek = null);
}
