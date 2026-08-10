using Api.Accounts;

namespace Api.Tests.Accounts;

// Real device-alert delivery is out of scope for S02-07; this proves that is intentional,
// not an accidentally-untested code path.
public sealed class NewDeviceAlertSenderTests
{
    [Fact]
    public async Task SendAsync_ThrowsNotSupportedException()
    {
        var sender = new NewDeviceAlertSender();

        await Assert.ThrowsAsync<NotSupportedException>(
            () => sender.SendAsync("someone@example.com", CancellationToken.None));
    }
}
