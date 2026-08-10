using System.Collections.Concurrent;
using Api.Accounts;

namespace Api.Tests.Accounts;

// Shared across test files (not nested) because both AccountServiceNewDeviceAlertTests and
// Api.Tests.Auth.DevicePairingEndpointsTests need this.
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
