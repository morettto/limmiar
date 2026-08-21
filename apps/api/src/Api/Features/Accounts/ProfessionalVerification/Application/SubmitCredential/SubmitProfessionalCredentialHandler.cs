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
            var inReview = account with
            {
                VerificationStatus = AccountVerificationStatus.InReview,
                RejectionReason = null,
                VerificationSubmittedAt = DateTimeOffset.UtcNow,
            };
            await store.UpdateAsync(inReview, cancellationToken);
            return SubmitProfessionalCredentialResult.Success(inReview, DocumentReviewSlaBusinessDays);
        }

        var verification = await councilRegistryVerifier.VerifyAsync(request.Type, request.RegistryNumber!, request.RegistryUf!, cancellationToken);
        var decided = account with
        {
            VerificationStatus = verification.Verified ? AccountVerificationStatus.Active : AccountVerificationStatus.Rejected,
            RejectionReason = verification.FailureReason,
            VerificationSubmittedAt = DateTimeOffset.UtcNow,
        };
        await store.UpdateAsync(decided, cancellationToken);
        return SubmitProfessionalCredentialResult.Success(decided);
    }
}
