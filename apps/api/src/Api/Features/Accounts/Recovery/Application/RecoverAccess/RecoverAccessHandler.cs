using Mediator;
using static Api.Accounts.AccountAuthenticationOrchestration;

namespace Api.Accounts;

public sealed class RecoverAccessHandler(IAccountStore store, IPasswordVerifierComparer comparer, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    : IRequestHandler<RecoverAccessCommand, AccountRecoveryResult>
{
    public async ValueTask<AccountRecoveryResult> Handle(RecoverAccessCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = AccountEmail.Normalize(request.Email);
        var account = await store.FindByEmailAsync(normalizedEmail, cancellationToken);

        var hasRealVerifier = account?.RecoveryVerifier is not null;
        var storedVerifier = account?.RecoveryVerifier ?? AccountVerifierLengths.Dummy;
        var matches = comparer.Matches(request.RecoveryVerifier, storedVerifier);

        if (account is null || !hasRealVerifier || !matches)
        {
            return AccountRecoveryResult.Failure(AccountRecoveryFailureReason.InvalidRecoveryPhrase);
        }

        return AccountRecoveryResult.Success(
            account, IssueTwoFactorTicketIfRequired(account, twoFactorTicketIssuer), IssueSessionIfNoTwoFactorPending(account, sessionTokenIssuer));
    }
}
