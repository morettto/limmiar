namespace Api.Accounts;

public enum SubmitProfessionalCredentialFailureReason
{
    AccountNotFound,
    NotAProfessionalAccount,
    InvalidStateForSubmission,
}

public sealed class SubmitProfessionalCredentialResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public int? DocumentReviewSlaBusinessDays { get; init; }

    public SubmitProfessionalCredentialFailureReason? FailureReason { get; init; }

    public static SubmitProfessionalCredentialResult Success(Account account, int? documentReviewSlaBusinessDays = null) =>
        new() { Succeeded = true, Account = account, DocumentReviewSlaBusinessDays = documentReviewSlaBusinessDays };

    public static SubmitProfessionalCredentialResult Failure(SubmitProfessionalCredentialFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
