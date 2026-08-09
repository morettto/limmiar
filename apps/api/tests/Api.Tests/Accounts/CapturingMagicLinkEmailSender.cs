using System.Collections.Concurrent;
using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Test-only <see cref="IMagicLinkEmailSender"/> that records the last token sent per e-mail
/// instead of ever sending anything. Not nested inside a single test class (unlike e.g. each
/// test file's own private <c>StubGoogleIdentityProvider</c>) because both
/// <see cref="AccountServiceMagicLinkTests"/> and <c>Api.Tests.Auth.AuthEndpointsTests</c> need
/// one, and this one is stateful enough (a whole capture dictionary) that duplicating it would
/// be worse than one shared, internal class.
/// </summary>
internal sealed class CapturingMagicLinkEmailSender : IMagicLinkEmailSender
{
    private readonly ConcurrentDictionary<string, string> _lastTokenByEmail = new(StringComparer.Ordinal);

    public Task SendAsync(string email, string token, CancellationToken cancellationToken)
    {
        _lastTokenByEmail[email] = token;
        return Task.CompletedTask;
    }

    public string? LastTokenSentTo(string email) => _lastTokenByEmail.GetValueOrDefault(email);

    public bool WasSentTo(string email) => _lastTokenByEmail.ContainsKey(email);
}
