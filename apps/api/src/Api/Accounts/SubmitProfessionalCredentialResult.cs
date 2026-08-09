namespace Api.Accounts;

public enum SubmitProfessionalCredentialFailureReason
{
    AccountNotFound,
    NotAProfessionalAccount,

    /// <summary>
    /// Submission is only accepted from <see cref="AccountVerificationStatus.Pending"/> or
    /// <see cref="AccountVerificationStatus.Rejected"/> -- an <see cref="AccountVerificationStatus.Active"/>
    /// account has nothing to (re)submit, and an <see cref="AccountVerificationStatus.InReview"/>
    /// one is already in the queue.
    /// </summary>
    InvalidStateForSubmission,
}

public sealed class SubmitProfessionalCredentialResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    /// <summary>Set only for the document path (Active/Rejected results carry no SLA).</summary>
    public int? DocumentReviewSlaBusinessDays { get; init; }

    public SubmitProfessionalCredentialFailureReason? FailureReason { get; init; }

    public static SubmitProfessionalCredentialResult Success(Account account, int? documentReviewSlaBusinessDays = null) =>
        new() { Succeeded = true, Account = account, DocumentReviewSlaBusinessDays = documentReviewSlaBusinessDays };

    public static SubmitProfessionalCredentialResult Failure(SubmitProfessionalCredentialFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
