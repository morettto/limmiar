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
public sealed record AccountGoogleAuthSuccess(
    Account Account,
    bool IsNewAccount,
    TwoFactorRequirement TwoFactorRequirement,
    string? TwoFactorTicket,
    SessionTokenPair? Session);

public sealed class ContinueWithGoogleHandler(
    IGoogleIdentityProvider googleIdentityProvider, IAccountStore store, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    : IRequestHandler<ContinueWithGoogleCommand, Result<AccountGoogleAuthSuccess, AccountGoogleAuthFailureReason>>
{
    public async ValueTask<Result<AccountGoogleAuthSuccess, AccountGoogleAuthFailureReason>> Handle(ContinueWithGoogleCommand request, CancellationToken cancellationToken)
    {
        var identity = await googleIdentityProvider.VerifyIdTokenAsync(request.IdToken, cancellationToken);
        if (identity is null)
        {
            return Result<AccountGoogleAuthSuccess, AccountGoogleAuthFailureReason>.Failure(AccountGoogleAuthFailureReason.InvalidGoogleToken);
        }

        var normalizedEmail = AccountEmail.Normalize(identity.Email);
        var existing = await store.FindByEmailAsync(normalizedEmail, cancellationToken);
        if (existing is not null)
        {
            return Result<AccountGoogleAuthSuccess, AccountGoogleAuthFailureReason>.Success(new AccountGoogleAuthSuccess(
                existing,
                IsNewAccount: false,
                TwoFactorPolicy.Determine(existing),
                IssueTwoFactorTicketIfRequired(existing, twoFactorTicketIssuer),
                IssueSessionIfNoTwoFactorPending(existing, sessionTokenIssuer)));
        }

        var account = new Account(
            Guid.NewGuid(), normalizedEmail, request.RequestedRole, PasswordVerifier: null, identity.SubjectId,
            VerificationStatus: InitialVerificationStatus(request.RequestedRole));
        await store.InsertAsync(account, cancellationToken);
        return Result<AccountGoogleAuthSuccess, AccountGoogleAuthFailureReason>.Success(new AccountGoogleAuthSuccess(
            account,
            IsNewAccount: true,
            TwoFactorPolicy.Determine(account),
            IssueTwoFactorTicketIfRequired(account, twoFactorTicketIssuer),
            IssueSessionIfNoTwoFactorPending(account, sessionTokenIssuer)));
    }

    private static AccountVerificationStatus InitialVerificationStatus(AccountRole role) =>
        role == AccountRole.Professional ? AccountVerificationStatus.Pending : AccountVerificationStatus.Active;
}
