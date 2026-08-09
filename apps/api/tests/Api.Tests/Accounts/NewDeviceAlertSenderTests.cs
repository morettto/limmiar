using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Covers the production placeholder <see cref="NewDeviceAlertSender"/> directly. No S02-07
/// test ever exercises this class in production: every test that reaches
/// <see cref="AccountService.NotifyNewDeviceLinkedAsync"/> either overrides
/// <see cref="INewDeviceAlertSender"/> with <see cref="CapturingNewDeviceAlertSender"/>, or
/// relies on the swallow-on-failure behavior around this exact placeholder (see
/// <see cref="AccountServiceNewDeviceAlertTests"/>). Same "provably intentional, not
/// accidentally untested" precedent as <see cref="MagicLinkEmailSenderTests"/>.
/// </summary>
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
