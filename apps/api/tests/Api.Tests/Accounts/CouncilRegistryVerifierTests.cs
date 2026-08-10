using Api.Accounts;

namespace Api.Tests.Accounts;

// Real CRP/CRM verification is out of scope (blocked on a contracted provider); this proves
// that is intentional, not an accidentally-untested code path.
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
