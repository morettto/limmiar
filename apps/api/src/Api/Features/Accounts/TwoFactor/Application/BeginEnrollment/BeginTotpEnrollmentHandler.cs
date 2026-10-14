using Mediator;

namespace Api.Accounts;

public sealed class BeginTotpEnrollmentHandler(IAccountStore store, ITotpProvider totpProvider)
    : IRequestHandler<BeginTotpEnrollmentCommand, BeginTotpEnrollmentResult>
{
    private const string TotpIssuer = "Limmiar";

    public async ValueTask<BeginTotpEnrollmentResult> Handle(BeginTotpEnrollmentCommand request, CancellationToken cancellationToken)
    {
        var account = await store.FindByIdAsync(request.AccountId, cancellationToken);
        if (account is null)
        {
            return BeginTotpEnrollmentResult.Failure(BeginTotpEnrollmentFailureReason.AccountNotFound);
        }

        if (account.Role != AccountRole.Professional || account.Email is null)
        {
            return BeginTotpEnrollmentResult.Failure(BeginTotpEnrollmentFailureReason.NotAProfessionalAccount);
        }

        if (account.TotpEnabledAt is not null)
        {
            return BeginTotpEnrollmentResult.Failure(BeginTotpEnrollmentFailureReason.AlreadyEnabled);
        }

        var secret = await store.GetOrCreatePendingTotpSecretAsync(account.Id, totpProvider.GenerateSecret(), cancellationToken);
        if (secret is null)
        {
            return BeginTotpEnrollmentResult.Failure(BeginTotpEnrollmentFailureReason.AlreadyEnabled);
        }

        var provisioningUri = totpProvider.BuildProvisioningUri(secret, account.Email, TotpIssuer);
        return BeginTotpEnrollmentResult.Success(secret, provisioningUri);
    }
}
