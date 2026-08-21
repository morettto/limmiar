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

        if (account.Role != AccountRole.Professional)
        {
            return BeginTotpEnrollmentResult.Failure(BeginTotpEnrollmentFailureReason.NotAProfessionalAccount);
        }

        if (account.TotpEnabledAt is not null)
        {
            return BeginTotpEnrollmentResult.Failure(BeginTotpEnrollmentFailureReason.AlreadyEnabled);
        }

        var secret = totpProvider.GenerateSecret();
        var pending = account with { TotpSecret = secret };
        await store.UpdateAsync(pending, cancellationToken);

        var provisioningUri = totpProvider.BuildProvisioningUri(secret, account.Email, TotpIssuer);
        return BeginTotpEnrollmentResult.Success(secret, provisioningUri);
    }
}
