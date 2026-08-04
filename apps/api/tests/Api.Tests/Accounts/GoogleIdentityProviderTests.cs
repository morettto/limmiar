using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Covers the production placeholder <see cref="GoogleIdentityProvider"/> directly.
/// AuthEndpointsTests never exercises this class in production: every test that reaches
/// /auth/google overrides <see cref="IGoogleIdentityProvider"/> with a fake, since real
/// Google ID token verification is explicitly out of scope for S02-01 (see the class's
/// own TODO). This test exists so that scope decision is provably intentional, not an
/// accidentally-untested code path.
/// </summary>
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
