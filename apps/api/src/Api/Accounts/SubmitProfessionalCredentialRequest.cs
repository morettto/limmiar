namespace Api.Accounts;

/// <summary>
/// Submits (or resubmits, after a <see cref="AccountVerificationStatus.Rejected"/>
/// outcome -- the "caminho de correção" acceptance criterion) a professional credential.
/// <see cref="RegistryNumber"/>/<see cref="RegistryUf"/> are required for
/// <see cref="ProfessionalCredentialType.Crp"/>/<see cref="ProfessionalCredentialType.Crm"/>;
/// <see cref="DocumentReference"/> is required for <see cref="ProfessionalCredentialType.Document"/>.
/// <see cref="DocumentReference"/> is an opaque reference to an already-uploaded file --
/// this contract does not cover the upload itself (no file-storage seam exists in this
/// repo yet; out of S02-02's scope, see the ticket's Handoff).
/// </summary>
public sealed record SubmitProfessionalCredentialRequest(
    ProfessionalCredentialType Type, string? RegistryNumber, string? RegistryUf, string? DocumentReference);

public sealed record SubmitProfessionalCredentialResponse(
    Guid AccountId, AccountVerificationStatus Status, string? RejectionReason, int? DocumentReviewSlaBusinessDays);
