using Api.Platform;
using Mediator;
using static Api.Accounts.AccountAuthenticationOrchestration;

namespace Api.Accounts;

public enum AccountLoginFailureReason
{
    InvalidCredentials,
}

/// <summary>
/// Success payload of <see cref="LoginHandler"/> -- the <c>TValue</c> of
/// <see cref="Result{TValue,TFailure}"/> (molde Api.Platform, ADR
/// docs/adr/0011-store-service-nao-devolve-tuplo-nullable.md).
/// </summary>
public sealed record AccountLoginSuccess(
    Account Account,
    TwoFactorRequirement TwoFactorRequirement,
    string? TwoFactorTicket,
    SessionTokenPair? Session);

public sealed class LoginHandler(IAccountStore store, IPasswordVerifierComparer comparer, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    : IRequestHandler<LoginCommand, Result<AccountLoginSuccess, AccountLoginFailureReason>>
{
    public async ValueTask<Result<AccountLoginSuccess, AccountLoginFailureReason>> Handle(LoginCommand request, CancellationToken cancellationToken)
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
            return Result<AccountLoginSuccess, AccountLoginFailureReason>.Failure(AccountLoginFailureReason.InvalidCredentials);
        }

        return Result<AccountLoginSuccess, AccountLoginFailureReason>.Success(new AccountLoginSuccess(
            account,
            TwoFactorPolicy.Determine(account),
            IssueTwoFactorTicketIfRequired(account, twoFactorTicketIssuer),
            IssueSessionIfNoTwoFactorPending(account, sessionTokenIssuer)));
    }
}
