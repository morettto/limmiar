using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Api.Accounts;

public sealed class TwoFactorTicketIssuer : ITwoFactorTicketIssuer
{
    public static readonly TimeSpan TicketLifetime = TimeSpan.FromMinutes(10);

    private readonly Func<DateTimeOffset> _clock;
    private readonly ConcurrentDictionary<string, (Guid AccountId, DateTimeOffset ExpiresAt)> _tickets = new(StringComparer.Ordinal);

    public TwoFactorTicketIssuer(Func<DateTimeOffset>? clock = null)
    {
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public string Issue(Guid accountId)
    {
        var ticket = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        _tickets[ticket] = (accountId, _clock() + TicketLifetime);
        return ticket;
    }

    // Plain dictionary lookup, no constant-time comparison: the ticket is a key,
    // never compared byte-by-byte against a caller-supplied secret.
    public bool Validate(string ticket, Guid accountId)
    {
        if (!_tickets.TryGetValue(ticket, out var entry))
        {
            return false;
        }

        if (entry.ExpiresAt <= _clock())
        {
            _tickets.TryRemove(ticket, out _);
            return false;
        }

        return entry.AccountId == accountId;
    }

    public void Invalidate(string ticket) => _tickets.TryRemove(ticket, out _);
}
