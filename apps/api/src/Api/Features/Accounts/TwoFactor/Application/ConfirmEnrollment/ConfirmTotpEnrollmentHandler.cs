using Mediator;

namespace Api.Accounts;

public sealed class ConfirmTotpEnrollmentHandler(IAccountStore store, ITotpProvider totpProvider, ISessionTokenIssuer sessionTokenIssuer)
    : IRequestHandler<ConfirmTotpEnrollmentCommand, ConfirmTotpEnrollmentResult>
{
    public async ValueTask<ConfirmTotpEnrollmentResult> Handle(ConfirmTotpEnrollmentCommand request, CancellationToken cancellationToken)
    {
        var account = await store.FindByIdAsync(request.AccountId, cancellationToken);
        if (account is null)
        {
            return ConfirmTotpEnrollmentResult.Failure(ConfirmTotpEnrollmentFailureReason.AccountNotFound);
        }

        if (account.TotpSecret is null || account.TotpEnabledAt is not null)
        {
            return ConfirmTotpEnrollmentResult.Failure(ConfirmTotpEnrollmentFailureReason.NotPending);
        }

        if (!totpProvider.ValidateCode(account.TotpSecret, request.Code, DateTimeOffset.UtcNow))
        {
            return ConfirmTotpEnrollmentResult.Failure(ConfirmTotpEnrollmentFailureReason.InvalidCode);
        }

        var backupCodes = BackupCodeGenerator.GenerateCodes();
        IReadOnlyList<string> backupCodeHashes = backupCodes.Select(BackupCodeGenerator.Hash).ToList();
        var confirmed = account with { TotpEnabledAt = DateTimeOffset.UtcNow, TotpBackupCodeHashes = backupCodeHashes };
        await store.UpdateAsync(confirmed, cancellationToken);

        return ConfirmTotpEnrollmentResult.Success(confirmed, backupCodes, sessionTokenIssuer.IssuePair(confirmed.Id));
    }
}
