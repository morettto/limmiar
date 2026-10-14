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
            var updated = await store.MutateAsync(account.Id, current =>
                current.TotpEnabledAt is not null && (current.TotpBackupCodeHashes ?? []).Contains(hash)
                    ? current with { TotpBackupCodeHashes = current.TotpBackupCodeHashes!.Where(stored => stored != hash).ToList() }
                    : null, cancellationToken);
            if (updated is null) return VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.InvalidCode);
            return VerifyTotpChallengeResult.Success(updated, sessionTokenIssuer.IssuePair(updated.Id));
        }

        return VerifyTotpChallengeResult.Failure(VerifyTotpChallengeFailureReason.InvalidCode);
    }
}
