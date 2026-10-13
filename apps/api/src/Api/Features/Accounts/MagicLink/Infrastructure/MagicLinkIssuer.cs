using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Api.Accounts;

public sealed class MagicLinkIssuer : IMagicLinkIssuer
{
    public static readonly TimeSpan TicketLifetime = TimeSpan.FromMinutes(5);

    private readonly Func<DateTimeOffset> _clock;
    private readonly ConcurrentDictionary<string, (MagicLinkTicketData Data, DateTimeOffset ExpiresAt)> _tickets = new(StringComparer.Ordinal);

    public MagicLinkIssuer(Func<DateTimeOffset>? clock = null)
    {
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
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
