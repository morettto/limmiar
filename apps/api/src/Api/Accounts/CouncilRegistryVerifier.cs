namespace Api.Accounts;

/// <summary>
/// TODO(follow-up ticket -- not one of S02-02's confirmed backend seams, see the
/// session's final report): no real CRP/CRM integration is available yet. Researched
/// during S02-02: CFM's official web service requires a signed access-key contract with a
/// company's legal representative (Resolução CFM 2.129/15) -- a business decision, not
/// something this session can arrange. CFP's public lookup
/// (cn-api.cfp.org.br/psi/busca) is ReCaptcha-protected against automation and will not be
/// circumvented. Commercial aggregators (Netrin, Infosimples) cover both councils but also
/// require a paid contract. Real integration is blocked on a human choosing and
/// contracting one of these -- see this ticket's Handoff.
///
/// Every test that reaches <see cref="AccountService.SubmitProfessionalCredentialAsync"/>
/// with a CRP/CRM credential overrides the DI registration of
/// <see cref="ICouncilRegistryVerifier"/> with a fake; nothing in production traffic
/// should reach this placeholder until the real integration lands.
/// </summary>
public sealed class CouncilRegistryVerifier : ICouncilRegistryVerifier
{
    public Task<CouncilRegistryVerificationResult> VerifyAsync(
        ProfessionalCredentialType type, string registryNumber, string registryUf, CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "CRP/CRM registry verification is not implemented yet (S02-02 backend seam scope, " +
            "blocked on a contracted provider -- see the TODO on Api.Accounts.CouncilRegistryVerifier).");
}
