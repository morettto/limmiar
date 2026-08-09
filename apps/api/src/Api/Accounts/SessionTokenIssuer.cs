using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Api.Accounts;

/// <summary>
/// In-memory <see cref="ISessionTokenIssuer"/> -- same placeholder fidelity as
/// <see cref="InMemoryAccountStore"/>/<see cref="TwoFactorTicketIssuer"/> (does not survive
/// a process restart or work across multiple instances; TODO follow-up ticket once this
/// backend has a real Postgres-backed session store).
/// </summary>
public sealed class SessionTokenIssuer : ISessionTokenIssuer
{
    /// <summary>How long an access token remains valid after issuance.</summary>
    public static readonly TimeSpan AccessTokenLifetime = TimeSpan.FromMinutes(15);

    /// <summary>How long a refresh token remains valid after issuance (per rotation).</summary>
    public static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(30);

    /// <summary>
    /// Immutable per-token record (same "reassign the dictionary slot instead of mutating
    /// a shared object" discipline as <see cref="TwoFactorTicketIssuer"/>'s tuple values):
    /// marking a token <see cref="Used"/> replaces the dictionary entry with a `with`-copy
    /// rather than mutating a reference multiple readers might hold.
    /// </summary>
    private readonly record struct RefreshTokenRecord(Guid AccountId, Guid FamilyId, DateTimeOffset ExpiresAt, bool Used);

    /// <summary>
    /// Carries <see cref="FamilyId"/> (not just <see cref="AccountId"/>) precisely so
    /// <see cref="ValidateAccess"/> can honour family revocation -- security-review finding:
    /// without it, an access token minted just before a refresh-token reuse revoked its
    /// family would keep validating for its own remaining lifetime (up to
    /// <see cref="AccessTokenLifetime"/>) even though the family that issued it is
    /// confirmed compromised.
    /// </summary>
    private readonly record struct AccessTokenRecord(Guid AccountId, Guid FamilyId, DateTimeOffset ExpiresAt);

    private readonly Func<DateTimeOffset> _clock;
    private readonly ConcurrentDictionary<string, AccessTokenRecord> _accessTokens = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, RefreshTokenRecord> _refreshTokens = new(StringComparer.Ordinal);

    /// <summary>
    /// Families whose tokens must never validate again, regardless of expiry. A
    /// <see cref="ConcurrentDictionary{TKey,TValue}"/> used as a set (value is unused) gives
    /// O(1) revocation-check without iterating every token this issuer has ever handed out.
    /// </summary>
    private readonly ConcurrentDictionary<Guid, byte> _revokedFamilies = new();

    /// <param name="clock">
    /// Defaults to <see cref="DateTimeOffset.UtcNow"/>. Overridable so tests can prove
    /// expiry without a real <c>Thread.Sleep</c> -- same pattern as <see cref="TwoFactorTicketIssuer"/>.
    /// </param>
    public SessionTokenIssuer(Func<DateTimeOffset>? clock = null)
    {
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public SessionTokenPair IssuePair(Guid accountId) => IssuePairForFamily(accountId, Guid.NewGuid());

    public RefreshSessionResult Refresh(string refreshToken)
    {
        if (!_refreshTokens.TryGetValue(refreshToken, out var record))
        {
            return RefreshSessionResult.Failure();
        }

        if (_revokedFamilies.ContainsKey(record.FamilyId))
        {
            return RefreshSessionResult.Failure();
        }

        if (record.ExpiresAt <= _clock())
        {
            return RefreshSessionResult.Failure();
        }

        if (record.Used)
        {
            // Reuse detected: this exact token was already exchanged once, so a second
            // presentation of it means a copy is circulating somewhere. The whole family
            // dies here -- not just this token -- because there is no way to tell which of
            // its other members (already-issued-but-not-yet-presented tokens included) the
            // same copy has, or will, reach.
            _revokedFamilies[record.FamilyId] = 0;
            return RefreshSessionResult.Failure();
        }

        _refreshTokens[refreshToken] = record with { Used = true };
        var pair = IssuePairForFamily(record.AccountId, record.FamilyId);
        return RefreshSessionResult.Success(pair);
    }

    public Guid? ValidateAccess(string accessToken)
    {
        if (!_accessTokens.TryGetValue(accessToken, out var record))
        {
            return null;
        }

        if (_revokedFamilies.ContainsKey(record.FamilyId))
        {
            return null;
        }

        return record.ExpiresAt > _clock() ? record.AccountId : null;
    }

    private SessionTokenPair IssuePairForFamily(Guid accountId, Guid familyId)
    {
        var now = _clock();
        var accessToken = GenerateToken();
        var refreshToken = GenerateToken();
        var accessExpiresAt = now + AccessTokenLifetime;
        var refreshExpiresAt = now + RefreshTokenLifetime;

        _accessTokens[accessToken] = new AccessTokenRecord(accountId, familyId, accessExpiresAt);
        _refreshTokens[refreshToken] = new RefreshTokenRecord(accountId, familyId, refreshExpiresAt, Used: false);

        return new SessionTokenPair(accessToken, refreshToken, accessExpiresAt, refreshExpiresAt);
    }

    private static string GenerateToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
}
