using Api.Platform;
using Mediator;
using static Api.Accounts.AccountAuthenticationOrchestration;

namespace Api.Accounts;

public enum AccountGoogleAuthFailureReason
{
    InvalidGoogleToken,
}

/// <summary>
/// Success payload of <see cref="ContinueWithGoogleHandler"/> -- the <c>TValue</c> of
/// <see cref="Result{TValue,TFailure}"/> (molde Api.Platform, ADR
/// docs/adr/0011-store-service-nao-devolve-tuplo-nullable.md).
/// </summary>
/// <remarks>
/// Construtor privado, <see cref="For"/> é a única fábrica -- mesmo invariante de
/// <see cref="AccountLoginSuccess"/> (S08-28), ver lá o porquê.
/// </remarks>
public sealed record AccountGoogleAuthSuccess
{
    public Account Account { get; }

    public bool IsNewAccount { get; }

    public TwoFactorRequirement TwoFactorRequirement { get; }

    public string? TwoFactorTicket { get; }

    public SessionTokenPair? Session { get; }

    private AccountGoogleAuthSuccess(
        Account account, bool isNewAccount, TwoFactorRequirement twoFactorRequirement, string? twoFactorTicket, SessionTokenPair? session)
    {
        Account = account;
        IsNewAccount = isNewAccount;
        TwoFactorRequirement = twoFactorRequirement;
        TwoFactorTicket = twoFactorTicket;
        Session = session;
    }

    public static AccountGoogleAuthSuccess For(
        Account account, bool isNewAccount, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    {
        var requirement = TwoFactorPolicy.Determine(account);
        return new(
            account,
            isNewAccount,
            requirement,
            IssueTwoFactorTicketIfRequired(account, requirement, twoFactorTicketIssuer),
            IssueSessionIfNoTwoFactorPending(account, requirement, sessionTokenIssuer));
    }
}

public sealed class ContinueWithGoogleHandler(
    IGoogleIdentityProvider googleIdentityProvider, IAccountStore store, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    : IRequestHandler<ContinueWithGoogleCommand, Result<AccountGoogleAuthSuccess, AccountGoogleAuthFailureReason>>
{
    public async ValueTask<Result<AccountGoogleAuthSuccess, AccountGoogleAuthFailureReason>> Handle(ContinueWithGoogleCommand request, CancellationToken cancellationToken)
    {
        var identity = await googleIdentityProvider.VerifyIdTokenAsync(request.IdToken, cancellationToken);
        if (identity is null)
        {
            return AccountGoogleAuthFailureReason.InvalidGoogleToken;
        }

        var normalizedEmail = AccountEmail.Normalize(identity.Email);
        var existing = await store.FindByEmailAsync(normalizedEmail, cancellationToken);
        var account = existing ?? await CreateAccountAsync(normalizedEmail, request.RequestedRole, identity.SubjectId, store, cancellationToken);
        return AccountGoogleAuthSuccess.For(account, isNewAccount: existing is null, twoFactorTicketIssuer, sessionTokenIssuer);
    }

    private static async Task<Account> CreateAccountAsync(
        string normalizedEmail, AccountRole requestedRole, string googleSubjectId, IAccountStore store, CancellationToken cancellationToken)
    {
        var account = new Account(
            Guid.NewGuid(), normalizedEmail, requestedRole, PasswordVerifier: null, googleSubjectId,
            VerificationStatus: InitialVerificationStatus(requestedRole));
        await store.InsertAsync(account, cancellationToken);
        return account;
    }

    private static AccountVerificationStatus InitialVerificationStatus(AccountRole role) =>
        role == AccountRole.Professional ? AccountVerificationStatus.Pending : AccountVerificationStatus.Active;
}
