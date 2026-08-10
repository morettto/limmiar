using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Api.Accounts;

public sealed class SessionTokenIssuer : ISessionTokenIssuer
{
    public static readonly TimeSpan AccessTokenLifetime = TimeSpan.FromMinutes(15);

    public static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(30);

    private readonly record struct RefreshTokenRecord(Guid AccountId, Guid FamilyId, DateTimeOffset ExpiresAt, bool Used);

    private readonly record struct AccessTokenRecord(Guid AccountId, Guid FamilyId, DateTimeOffset ExpiresAt);

    private readonly Func<DateTimeOffset> _clock;
    private readonly ConcurrentDictionary<string, AccessTokenRecord> _accessTokens = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, RefreshTokenRecord> _refreshTokens = new(StringComparer.Ordinal);

    private readonly ConcurrentDictionary<Guid, byte> _revokedFamilies = new();

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
            // Reuse of an already-exchanged token revokes the whole family: a copy is
            // circulating and any other token in the family may already be compromised.
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
