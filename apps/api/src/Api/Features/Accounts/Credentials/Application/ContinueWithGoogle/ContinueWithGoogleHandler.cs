using Mediator;
using static Api.Accounts.AccountAuthenticationOrchestration;

namespace Api.Accounts;

public sealed class ContinueWithGoogleHandler(
    IGoogleIdentityProvider googleIdentityProvider, IAccountStore store, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    : IRequestHandler<ContinueWithGoogleCommand, AccountGoogleAuthResult>
{
    public async ValueTask<AccountGoogleAuthResult> Handle(ContinueWithGoogleCommand request, CancellationToken cancellationToken)
    {
        var identity = await googleIdentityProvider.VerifyIdTokenAsync(request.IdToken, cancellationToken);
        if (identity is null)
        {
            return AccountGoogleAuthResult.Failure(AccountGoogleAuthFailureReason.InvalidGoogleToken);
        }

        var normalizedEmail = AccountEmail.Normalize(identity.Email);
        var existing = await store.FindByEmailAsync(normalizedEmail, cancellationToken);
        if (existing is not null)
        {
            return AccountGoogleAuthResult.Success(
                existing, isNewAccount: false, IssueTwoFactorTicketIfRequired(existing, twoFactorTicketIssuer),
                IssueSessionIfNoTwoFactorPending(existing, sessionTokenIssuer));
        }

        var account = new Account(
            Guid.NewGuid(), normalizedEmail, request.RequestedRole, PasswordVerifier: null, identity.SubjectId,
            VerificationStatus: InitialVerificationStatus(request.RequestedRole));
        await store.InsertAsync(account, cancellationToken);
        return AccountGoogleAuthResult.Success(
            account, isNewAccount: true, IssueTwoFactorTicketIfRequired(account, twoFactorTicketIssuer),
            IssueSessionIfNoTwoFactorPending(account, sessionTokenIssuer));
    }

    private static AccountVerificationStatus InitialVerificationStatus(AccountRole role) =>
        role == AccountRole.Professional ? AccountVerificationStatus.Pending : AccountVerificationStatus.Active;
}
