namespace Api.Accounts;

public sealed record SubmitProfessionalCredentialRequest(
    ProfessionalCredentialType Type, string? RegistryNumber, string? RegistryUf, string? DocumentReference);

public sealed record SubmitProfessionalCredentialResponse(
    Guid AccountId, AccountVerificationStatus Status, string? RejectionReason, int? DocumentReviewSlaBusinessDays);
