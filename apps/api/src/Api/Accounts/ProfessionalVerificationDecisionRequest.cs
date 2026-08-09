namespace Api.Accounts;

/// <summary>
/// The human reviewer's decision on a queued document-path submission (see
/// <see cref="IAccountStore.ListPendingDocumentReviewAsync"/>). <see cref="RejectionReason"/>
/// is required when <see cref="Approved"/> is false -- acceptance criterion: "Reprovação
/// mostra motivo legível".
/// </summary>
public sealed record ProfessionalVerificationDecisionRequest(bool Approved, string? RejectionReason);

public sealed record ProfessionalVerificationDecisionResponse(Guid AccountId, AccountVerificationStatus Status, string? RejectionReason);
