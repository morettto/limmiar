using Mediator;

namespace Api.Accounts;

public sealed class SubmitProfessionalCredentialHandler(IAccountStore store, ICouncilRegistryVerifier councilRegistryVerifier)
    : IRequestHandler<SubmitProfessionalCredentialCommand, SubmitProfessionalCredentialResult>
{
    public const int DocumentReviewSlaBusinessDays = 5;

    public async ValueTask<SubmitProfessionalCredentialResult> Handle(SubmitProfessionalCredentialCommand request, CancellationToken cancellationToken)
    {
        var account = await store.FindByIdAsync(request.AccountId, cancellationToken);
        if (account is null)
        {
            return SubmitProfessionalCredentialResult.Failure(SubmitProfessionalCredentialFailureReason.AccountNotFound);
        }

        if (account.Role != AccountRole.Professional)
        {
            return SubmitProfessionalCredentialResult.Failure(SubmitProfessionalCredentialFailureReason.NotAProfessionalAccount);
        }

        if (account.VerificationStatus is not (AccountVerificationStatus.Pending or AccountVerificationStatus.Rejected))
        {
            return SubmitProfessionalCredentialResult.Failure(SubmitProfessionalCredentialFailureReason.InvalidStateForSubmission);
        }

        if (request.Type == ProfessionalCredentialType.Document)
        {
            var inReview = await store.MutateAsync(account.Id, current => current.VerificationStatus is not (AccountVerificationStatus.Pending or AccountVerificationStatus.Rejected) ? null : current with
            {
                VerificationStatus = AccountVerificationStatus.InReview,
                RejectionReason = null,
                VerificationSubmittedAt = DateTimeOffset.UtcNow,
            }, cancellationToken);
            return inReview is null ? SubmitProfessionalCredentialResult.Failure(SubmitProfessionalCredentialFailureReason.InvalidStateForSubmission)
                : SubmitProfessionalCredentialResult.Success(inReview, DocumentReviewSlaBusinessDays);
        }

        var verification = await councilRegistryVerifier.VerifyAsync(request.Type, request.RegistryNumber!, request.RegistryUf!, cancellationToken);
        var decided = await store.MutateAsync(account.Id, current => current.VerificationStatus is not (AccountVerificationStatus.Pending or AccountVerificationStatus.Rejected) ? null : current with
        {
            VerificationStatus = verification.Verified ? AccountVerificationStatus.Active : AccountVerificationStatus.Rejected,
            RejectionReason = verification.FailureReason,
            VerificationSubmittedAt = DateTimeOffset.UtcNow,
        }, cancellationToken);
        return decided is null ? SubmitProfessionalCredentialResult.Failure(SubmitProfessionalCredentialFailureReason.InvalidStateForSubmission)
            : SubmitProfessionalCredentialResult.Success(decided);
    }
}
