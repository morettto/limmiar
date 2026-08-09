using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Covers the production placeholder <see cref="CouncilRegistryVerifier"/> directly.
/// Every S02-02 test that reaches the CRP/CRM submission path overrides
/// <see cref="ICouncilRegistryVerifier"/> with a fake, since real CRP/CRM verification is
/// explicitly out of scope (see the class's own TODO -- blocked on a contracted
/// provider). This test exists so that scope decision is provably intentional, not an
/// accidentally-untested code path.
/// </summary>
public sealed class CouncilRegistryVerifierTests
{
    [Fact]
    public async Task VerifyAsync_ThrowsNotSupportedException()
    {
        var verifier = new CouncilRegistryVerifier();

        await Assert.ThrowsAsync<NotSupportedException>(
            () => verifier.VerifyAsync(ProfessionalCredentialType.Crp, "06/123456", "SP", CancellationToken.None));
    }
}
