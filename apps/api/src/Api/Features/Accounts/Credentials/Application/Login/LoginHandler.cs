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
/// <remarks>
/// S08-28: construtor privado, <see cref="For"/> é a única fábrica. TwoFactorRequirement é
/// sempre derivado da <see cref="Account"/> passada a <see cref="For"/> -- é impossível construir
/// um payload com um requisito incoerente com a conta que vai no mesmo objeto.
/// </remarks>
public sealed record AccountLoginSuccess
{
    public Account Account { get; }

    public TwoFactorRequirement TwoFactorRequirement { get; }

    public string? TwoFactorTicket { get; }

    public SessionTokenPair? Session { get; }

    private AccountLoginSuccess(Account account, TwoFactorRequirement twoFactorRequirement, string? twoFactorTicket, SessionTokenPair? session)
    {
        Account = account;
        TwoFactorRequirement = twoFactorRequirement;
        TwoFactorTicket = twoFactorTicket;
        Session = session;
    }

    public static AccountLoginSuccess For(Account account, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    {
        var requirement = TwoFactorPolicy.Determine(account);
        return new(
            account,
            requirement,
            IssueTwoFactorTicketIfRequired(account, requirement, twoFactorTicketIssuer),
            IssueSessionIfNoTwoFactorPending(account, requirement, sessionTokenIssuer));
    }
}

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
            return AccountLoginFailureReason.InvalidCredentials;
        }

        return AccountLoginSuccess.For(account, twoFactorTicketIssuer, sessionTokenIssuer);
    }
}
