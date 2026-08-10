using System.Collections.Concurrent;
using Api.Accounts;

namespace Api.Tests.Accounts;

// Shared across test files (not nested) because both AccountServiceMagicLinkTests and
// Api.Tests.Auth.AuthEndpointsTests need this capture dictionary.
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
