using Mediator;
using static Api.Accounts.AccountAuthenticationOrchestration;

namespace Api.Accounts;

public sealed class LoginHandler(IAccountStore store, IPasswordVerifierComparer comparer, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    : IRequestHandler<LoginCommand, AccountLoginResult>
{
    public async ValueTask<AccountLoginResult> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = AccountEmail.Normalize(request.Email);
        var account = await store.FindByEmailAsync(normalizedEmail, cancellationToken);

        // Always compare against a real or dummy verifier of equal length before branching:
        // keeps unknown-email, wrong-password and Google-only (no verifier) timing identical.
        var hasRealVerifier = account?.PasswordVerifier is not null;
        var storedVerifier = account?.PasswordVerifier ?? AccountVerifierLengths.Dummy;
        var matches = comparer.Matches(request.PasswordVerifier, storedVerifier);

        if (account is null || !hasRealVerifier || !matches)
        {
            return AccountLoginResult.Failure(AccountLoginFailureReason.InvalidCredentials);
        }

        return AccountLoginResult.Success(
            account, IssueTwoFactorTicketIfRequired(account, twoFactorTicketIssuer), IssueSessionIfNoTwoFactorPending(account, sessionTokenIssuer));
    }
}
