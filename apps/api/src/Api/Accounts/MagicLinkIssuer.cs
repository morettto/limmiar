using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Api.Accounts;

public sealed class MagicLinkIssuer : IMagicLinkIssuer
{
    public static readonly TimeSpan DefaultTokenLifetime = TimeSpan.FromMinutes(15);

    public static readonly TimeSpan TicketLifetime = TimeSpan.FromMinutes(5);

    private readonly Func<DateTimeOffset> _clock;
    private readonly TimeSpan _tokenLifetime;
    private readonly ConcurrentDictionary<string, (string Email, DateTimeOffset ExpiresAt)> _tokens = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, (MagicLinkTicketData Data, DateTimeOffset ExpiresAt)> _tickets = new(StringComparer.Ordinal);

    public MagicLinkIssuer(Func<DateTimeOffset>? clock = null, TimeSpan? tokenLifetime = null)
    {
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _tokenLifetime = tokenLifetime ?? DefaultTokenLifetime;
    }

    public string IssueToken(string email)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        _tokens[token] = (email, _clock() + _tokenLifetime);
        return token;
    }

    public string? ConsumeToken(string token)
    {
        // TryRemove, not TryGetValue: an expired token must still be burned on this call.
        if (!_tokens.TryRemove(token, out var entry))
        {
            return null;
        }

        return entry.ExpiresAt > _clock() ? entry.Email : null;
    }

    public string IssueTicket(MagicLinkTicketData ticket)
    {
        var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        _tickets[id] = (ticket, _clock() + TicketLifetime);
        return id;
    }

    public MagicLinkTicketData? ConsumeTicket(string ticket)
    {
        if (!_tickets.TryRemove(ticket, out var entry))
        {
            return null;
        }

        return entry.ExpiresAt > _clock() ? entry.Data : null;
    }
}
