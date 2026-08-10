using Api.Accounts;

namespace Api.Tests.Accounts;

// Real Google ID token verification is out of scope for S02-01; this proves that is
// intentional, not an accidentally-untested code path.
public sealed class GoogleIdentityProviderTests
{
    [Fact]
    public async Task VerifyIdTokenAsync_ThrowsNotSupportedException()
    {
        var provider = new GoogleIdentityProvider();

        await Assert.ThrowsAsync<NotSupportedException>(
            () => provider.VerifyIdTokenAsync("any-id-token", CancellationToken.None));
    }
}
