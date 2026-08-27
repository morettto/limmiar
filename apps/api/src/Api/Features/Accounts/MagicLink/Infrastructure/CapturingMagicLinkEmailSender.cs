using System.Collections.Concurrent;

namespace Api.Accounts;

internal sealed class CapturingMagicLinkEmailSender : IMagicLinkEmailSender
{
    private readonly ConcurrentDictionary<string, string> _lastTokenByEmail = new(StringComparer.Ordinal);

    public Task SendAsync(string email, string token, CancellationToken cancellationToken)
    {
        _lastTokenByEmail[email] = token;
        return Task.CompletedTask;
    }

    public string? LastTokenSentTo(string email) => _lastTokenByEmail.GetValueOrDefault(email);
}
