using Mediator;

namespace Api.Accounts;

public sealed class DecideProfessionalVerificationHandler(IAccountStore store)
    : IRequestHandler<DecideProfessionalVerificationCommand, ProfessionalVerificationDecisionResult>
{
    public async ValueTask<ProfessionalVerificationDecisionResult> Handle(DecideProfessionalVerificationCommand request, CancellationToken cancellationToken)
    {
        var account = await store.FindByIdAsync(request.AccountId, cancellationToken);
        if (account is null)
        {
            return ProfessionalVerificationDecisionResult.Failure(ProfessionalVerificationDecisionFailureReason.AccountNotFound);
        }

        if (account.VerificationStatus != AccountVerificationStatus.InReview)
        {
            return ProfessionalVerificationDecisionResult.Failure(ProfessionalVerificationDecisionFailureReason.NotInReview);
        }

        var decided = account with
        {
            VerificationStatus = request.Approved ? AccountVerificationStatus.Active : AccountVerificationStatus.Rejected,
            RejectionReason = request.Approved ? null : request.RejectionReason,
        };
        await store.UpdateAsync(decided, cancellationToken);
        return ProfessionalVerificationDecisionResult.Success(decided);
    }
}
