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
        var confirmed = await store.MutateAsync(account.Id, current =>
            current.TotpSecret == account.TotpSecret && current.TotpEnabledAt is null
                ? current with { TotpEnabledAt = DateTimeOffset.UtcNow, TotpBackupCodeHashes = backupCodeHashes } : null,
            cancellationToken);
        if (confirmed is null) return ConfirmTotpEnrollmentResult.Failure(ConfirmTotpEnrollmentFailureReason.NotPending);

        return ConfirmTotpEnrollmentResult.Success(confirmed, backupCodes, sessionTokenIssuer.IssuePair(confirmed.Id));
    }
}
