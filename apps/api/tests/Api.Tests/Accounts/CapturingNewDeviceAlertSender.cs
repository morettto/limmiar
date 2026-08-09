using System.Collections.Concurrent;
using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Test-only <see cref="INewDeviceAlertSender"/> that records that an alert was "sent" per
/// e-mail instead of ever sending anything. Not nested inside a single test class (unlike
/// e.g. each test file's own private <c>StubGoogleIdentityProvider</c>) because both
/// <see cref="AccountServiceNewDeviceAlertTests"/> and <c>Api.Tests.Auth.DevicePairingEndpointsTests</c>
/// need one -- same "one shared, internal class" precedent as <see cref="CapturingMagicLinkEmailSender"/>.
/// </summary>
internal sealed class CapturingNewDeviceAlertSender : INewDeviceAlertSender
{
    private readonly ConcurrentDictionary<string, bool> _sentTo = new(StringComparer.Ordinal);

    public Task SendAsync(string email, CancellationToken cancellationToken)
    {
        _sentTo[email] = true;
        return Task.CompletedTask;
    }

    public bool WasSentTo(string email) => _sentTo.ContainsKey(email);
}
