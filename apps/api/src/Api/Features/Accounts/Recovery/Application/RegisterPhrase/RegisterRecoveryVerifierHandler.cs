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
        var updated = account with { RecoveryVerifier = SHA256.HashData(request.RecoveryVerifier) };
        await store.UpdateAsync(updated, cancellationToken);
        return RegisterRecoveryVerifierResult.Success(updated);
    }
}
