namespace Api.Accounts;

// Placeholder: real CRP/CRM verification needs a contracted registry provider.
// Tests override ICouncilRegistryVerifier with a fake; production should never reach this.
public sealed class CouncilRegistryVerifier : ICouncilRegistryVerifier
{
    public Task<CouncilRegistryVerificationResult> VerifyAsync(
        ProfessionalCredentialType type, string registryNumber, string registryUf, CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "CRP/CRM registry verification is not implemented yet (S02-02 backend seam scope, " +
            "blocked on a contracted provider -- see the TODO on Api.Accounts.CouncilRegistryVerifier).");
}
