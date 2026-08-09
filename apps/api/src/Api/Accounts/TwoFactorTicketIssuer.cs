using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Api.Accounts;

/// <summary>
/// In-memory <see cref="ITwoFactorTicketIssuer"/> -- same placeholder fidelity as
/// <see cref="InMemoryAccountStore"/> (does not survive a process restart or work across
/// multiple instances). TODO(follow-up ticket, S02-08): once this backend has a real
/// session/token mechanism, replace or unify this with it rather than keeping two separate
/// short-lived-credential concepts side by side.
/// </summary>
public sealed class TwoFactorTicketIssuer : ITwoFactorTicketIssuer
{
    /// <summary>How long a ticket remains valid after <see cref="Issue"/>.</summary>
    public static readonly TimeSpan TicketLifetime = TimeSpan.FromMinutes(10);

    private readonly Func<DateTimeOffset> _clock;
    private readonly ConcurrentDictionary<string, (Guid AccountId, DateTimeOffset ExpiresAt)> _tickets = new(StringComparer.Ordinal);

    /// <param name="clock">
    /// Defaults to <see cref="DateTimeOffset.UtcNow"/>. Overridable so tests can prove
    /// expiry without a real <c>Thread.Sleep</c>.
    /// </param>
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

    /// <summary>
    /// A plain <see cref="ConcurrentDictionary{TKey,TValue}.TryGetValue"/> lookup is
    /// sufficient here (no constant-time comparison needed): <paramref name="ticket"/> is
    /// used as a dictionary key, never compared byte-by-byte against a secret the caller
    /// controls the shape of -- there is nothing for a timing side-channel to leak that
    /// isn't already leaked by the dictionary's own hash-bucket lookup, unlike e.g.
    /// <see cref="ConstantTimePasswordVerifierComparer"/> where the caller supplies both
    /// sides of the comparison.
    /// </summary>
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
