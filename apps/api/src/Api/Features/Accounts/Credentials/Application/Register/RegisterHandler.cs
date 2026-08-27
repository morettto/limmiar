using Mediator;
using static Api.Accounts.AccountAuthenticationOrchestration;

namespace Api.Accounts;

public sealed class RegisterHandler(IAccountStore store, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    : IRequestHandler<RegisterCommand, AccountRegistrationResult>
{
    public async ValueTask<AccountRegistrationResult> Handle(RegisterCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = AccountEmail.Normalize(request.Email);
        var existing = await store.FindByEmailAsync(normalizedEmail, cancellationToken);
        if (existing is not null)
        {
            return AccountRegistrationResult.Failure(AccountRegistrationFailureReason.EmailAlreadyRegistered);
        }

        var account = new Account(
            Guid.NewGuid(), normalizedEmail, request.Role, request.PasswordVerifier, GoogleSubjectId: null,
            VerificationStatus: InitialVerificationStatus(request.Role));
        await store.InsertAsync(account, cancellationToken);
        return AccountRegistrationResult.Success(
            account, IssueTwoFactorTicketIfRequired(account, twoFactorTicketIssuer), IssueSessionIfNoTwoFactorPending(account, sessionTokenIssuer));
    }

    private static AccountVerificationStatus InitialVerificationStatus(AccountRole role) =>
        role == AccountRole.Professional ? AccountVerificationStatus.Pending : AccountVerificationStatus.Active;
}
