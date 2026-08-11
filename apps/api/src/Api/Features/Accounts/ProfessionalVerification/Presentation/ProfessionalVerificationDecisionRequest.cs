namespace Api.Accounts;

public sealed record ProfessionalVerificationDecisionRequest(bool Approved, string? RejectionReason);

public sealed record ProfessionalVerificationDecisionResponse(Guid AccountId, AccountVerificationStatus Status, string? RejectionReason);
