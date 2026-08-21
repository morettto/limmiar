using Mediator;

namespace Api.Accounts;

public sealed class VerifyTotpChallengeHandler(IAccountStore store, ITotpProvider totpProvider, ISessionTokenIssuer sessionTokenIssuer)
    : IRequestHandler<VerifyTotpChallengeCommand, VerifyTotpChallengeResult>
{
    public async ValueTask<VerifyTotpChallengeResult> Handle(VerifyTotpChallengeCommand request, CancellationToken cancellationToken)
    {
        var account = await store.FindByIdAsync(request.AccountId, cancellationToken);
        if (account is null)
        {
            return VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.AccountNotFound);
        }

        if (account.TotpEnabledAt is null)
        {
            return VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.NotEnabled);
        }

        if (!string.IsNullOrEmpty(request.Code))
        {
            return totpProvider.ValidateCode(account.TotpSecret!, request.Code, DateTimeOffset.UtcNow)
                ? VerifyTotpChallengeResult.Success(account, sessionTokenIssuer.IssuePair(account.Id))
                : VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.InvalidCode);
        }

        if (!string.IsNullOrEmpty(request.BackupCode))
        {
            var hash = BackupCodeGenerator.Hash(request.BackupCode);
            var hashes = account.TotpBackupCodeHashes ?? [];
            var matchIndex = hashes.ToList().FindIndex(stored => stored == hash);
            if (matchIndex < 0)
            {
                return VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.InvalidCode);
            }

            // Single-use: drop the matched hash so this backup code can never be consumed again.
            IReadOnlyList<string> remainingHashes = hashes.Where((_, index) => index != matchIndex).ToList();
            var updated = account with { TotpBackupCodeHashes = remainingHashes };
            await store.UpdateAsync(updated, cancellationToken);
            return VerifyTotpChallengeResult.Success(updated, sessionTokenIssuer.IssuePair(updated.Id));
        }

        return VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.InvalidCode);
    }
}
