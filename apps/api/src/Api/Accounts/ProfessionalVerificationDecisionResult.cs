namespace Api.Accounts;

public enum ProfessionalVerificationDecisionFailureReason
{
    AccountNotFound,

    /// <summary>Only an <see cref="AccountVerificationStatus.InReview"/> account can be decided.</summary>
    NotInReview,
}

public sealed class ProfessionalVerificationDecisionResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public ProfessionalVerificationDecisionFailureReason? FailureReason { get; init; }

    public static ProfessionalVerificationDecisionResult Success(Account account) =>
        new() { Succeeded = true, Account = account };

    public static ProfessionalVerificationDecisionResult Failure(ProfessionalVerificationDecisionFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
