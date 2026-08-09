using System.Text.Json.Serialization;

namespace Api.Accounts;

/// <summary>
/// Professional-credential verification state (Spec S02, S02-02). A <see cref="Account.Role"/>
/// of <see cref="AccountRole.Patient"/> is always <see cref="Active"/> from the moment it's
/// created -- patients have no credential to verify. A new
/// <see cref="AccountRole.Professional"/> account starts <see cref="Pending"/> and only
/// reaches <see cref="Active"/> through <see cref="AccountService.SubmitProfessionalCredentialAsync"/>
/// (CRP/CRM, auto-verified) or <see cref="AccountService.DecideProfessionalVerificationAsync"/>
/// (document path, human-reviewed).
///
/// Deliberately does NOT include the Spec-mãe's "suspensa" state -- that belongs to a
/// different ticket (e.g. device-loss lockout, S15-02), not S02-02's scope.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<AccountVerificationStatus>))]
public enum AccountVerificationStatus
{
    /// <summary>Professional account created but no credential submitted yet.</summary>
    Pending,

    /// <summary>
    /// Document path only: submitted, waiting in the human review queue (see
    /// <see cref="IAccountStore.ListPendingDocumentReviewAsync"/>) -- SLA declared via
    /// <see cref="AccountService.DocumentReviewSlaBusinessDays"/> (ADR-S02-05).
    /// </summary>
    InReview,

    /// <summary>Credential verified (CRP/CRM auto-check) or approved by human review.</summary>
    Active,

    /// <summary>
    /// CRP/CRM auto-check failed, or human review rejected the document -- see
    /// <see cref="Account.RejectionReason"/> for the reader-facing reason. Can resubmit
    /// (the "caminho de correção" acceptance criterion) via
    /// <see cref="AccountService.SubmitProfessionalCredentialAsync"/>.
    /// </summary>
    Rejected,
}
