using Api.Accounts;

namespace Api.Tests.Accounts;

// Real e-mail delivery is out of scope for S02-05; this proves that is intentional, not an
// accidentally-untested code path.
public sealed class MagicLinkEmailSenderTests
{
    [Fact]
    public async Task SendAsync_ThrowsNotSupportedException()
    {
        var sender = new MagicLinkEmailSender();

        await Assert.ThrowsAsync<NotSupportedException>(
            () => sender.SendAsync("someone@example.com", "some-token", CancellationToken.None));
    }
}
