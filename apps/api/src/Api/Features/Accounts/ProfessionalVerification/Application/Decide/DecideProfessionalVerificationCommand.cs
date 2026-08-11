using Mediator;

namespace Api.Accounts;

public sealed record DecideProfessionalVerificationCommand(Guid AccountId, bool Approved, string? RejectionReason)
    : IRequest<ProfessionalVerificationDecisionResult>;
