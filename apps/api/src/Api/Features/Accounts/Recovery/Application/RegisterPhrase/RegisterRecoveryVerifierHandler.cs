using System.Security.Cryptography;
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

        // Same discipline as RegisterHandler: only SHA256(verifier) is ever stored.
        var verifier = SHA256.HashData(request.RecoveryVerifier);
        var updated = await store.MutateAsync(account.Id, current => current with
        {
            RecoveryVerifier = verifier,
            RecoveryEnvelope = request.RecoveryEnvelope,
        }, cancellationToken);
        return updated is null ? RegisterRecoveryVerifierResult.Failure(RegisterRecoveryVerifierFailureReason.AccountNotFound)
            : RegisterRecoveryVerifierResult.Success(updated);
    }
}
