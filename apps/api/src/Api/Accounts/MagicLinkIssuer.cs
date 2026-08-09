using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Api.Accounts;

/// <summary>
/// In-memory <see cref="IMagicLinkIssuer"/> -- same placeholder fidelity as
/// <see cref="InMemoryAccountStore"/>/<see cref="TwoFactorTicketIssuer"/>/<see cref="DevicePairingIssuer"/>
/// (does not survive a process restart or work across multiple instances). TODO(follow-up
/// ticket, S02-05): once this backend has a real Postgres-backed session/token mechanism,
/// fold this into it rather than keeping yet another separate short-lived-credential store.
/// </summary>
public sealed class MagicLinkIssuer : IMagicLinkIssuer
{
    /// <summary>
    /// Default lifetime of a magic-link token after <see cref="IssueToken"/>. Fifteen minutes
    /// is a product/security balance -- long enough that a patient can find the e-mail and
    /// tap the link, short enough that a leaked/forwarded link stops being useful quickly.
    /// </summary>
    public static readonly TimeSpan DefaultTokenLifetime = TimeSpan.FromMinutes(15);

    /// <summary>
    /// How long a ticket (see <see cref="MagicLinkTicketData"/>) stays valid after
    /// <see cref="IssueTicket"/>. Much shorter than the token: this window only has to cover
    /// the time between the browser receiving the challenge and completing the WebAuthn
    /// ceremony, which is a single synchronous browser API call away.
    /// </summary>
    public static readonly TimeSpan TicketLifetime = TimeSpan.FromMinutes(5);

    private readonly Func<DateTimeOffset> _clock;
    private readonly TimeSpan _tokenLifetime;
    private readonly ConcurrentDictionary<string, (string Email, DateTimeOffset ExpiresAt)> _tokens = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, (MagicLinkTicketData Data, DateTimeOffset ExpiresAt)> _tickets = new(StringComparer.Ordinal);

    /// <param name="clock">
    /// Defaults to <see cref="DateTimeOffset.UtcNow"/>. Overridable so tests can prove expiry
    /// without a real <c>Thread.Sleep</c> -- same pattern as <see cref="TwoFactorTicketIssuer"/>.
    /// </param>
    /// <param name="tokenLifetime">
    /// Defaults to <see cref="DefaultTokenLifetime"/>. Overridable ONLY so the E2E environment
    /// can configure a short-lived token (via Program.Composition.cs's
    /// <c>MagicLink:TokenLifetimeSeconds</c>) and exercise a real "expired link" scenario
    /// without a live fifteen-minute wait -- same precedent as
    /// <see cref="DevicePairingIssuer"/>'s <c>sessionLifetime</c> parameter. Production leaves
    /// this unset. The ticket TTL is not made overridable the same way: nothing in this
    /// ticket's scope needs an E2E "expired ticket mid-ceremony" scenario.
    /// </param>
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
        // TryRemove (not TryGetValue) so the token is single-use even when it turns out to be
        // expired -- there is nothing to gain by leaving a dead entry sitting in the table.
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
