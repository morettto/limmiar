using Mediator;

namespace Api.Accounts;

public sealed record SubmitProfessionalCredentialCommand(
    Guid AccountId, ProfessionalCredentialType Type, string? RegistryNumber, string? RegistryUf, string? DocumentReference)
    : IRequest<SubmitProfessionalCredentialResult>;
