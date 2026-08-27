using Mediator;

namespace Api.Accounts;

public sealed class RegisterRecoveryVerifierHandler(IAccountStore store) : IRequestHandler<RegisterRecoveryVerifierCommand, RegisterRecoveryVerifierResult>
{
    public async ValueTask<RegisterRecoveryVerifierResult> Handle(RegisterRecoveryVerifierCommand request, CancellationToken cancellationToken)
    {
        var account = await store.FindByIdAsync(request.AccountId, cancellationToken);
        if (account is null)
        {
            return RegisterRecoveryVerifierResult.Failure(RegisterRecoveryVerifierFailureReason.AccountNotFound);
        }

        if (account.Role != AccountRole.Professional)
        {
            return RegisterRecoveryVerifierResult.Failure(RegisterRecoveryVerifierFailureReason.NotAProfessionalAccount);
        }

        var updated = account with { RecoveryVerifier = request.RecoveryVerifier };
        await store.UpdateAsync(updated, cancellationToken);
        return RegisterRecoveryVerifierResult.Success(updated);
    }
}
