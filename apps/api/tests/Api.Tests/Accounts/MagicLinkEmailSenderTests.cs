using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Covers the production placeholder <see cref="MagicLinkEmailSender"/> directly. No magic-link
/// test ever exercises this class in production: every test that reaches a magic-link endpoint
/// overrides <see cref="IMagicLinkEmailSender"/> with <see cref="CapturingMagicLinkEmailSender"/>,
/// since real e-mail delivery is explicitly out of scope for S02-05 (see the class's own TODO).
/// Same "provably intentional, not accidentally untested" precedent as
/// <see cref="GoogleIdentityProviderTests"/>.
/// </summary>
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
