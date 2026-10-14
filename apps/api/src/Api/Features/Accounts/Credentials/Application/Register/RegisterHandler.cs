using System.Security.Cryptography;
using Mediator;

namespace Api.Accounts;

public sealed class RegisterHandler(IAccountStore store, ITwoFactorTicketIssuer twoFactorTicketIssuer, ISessionTokenIssuer sessionTokenIssuer)
    : IRequestHandler<RegisterCommand, AccountRegistrationResult>
{
    public async ValueTask<AccountRegistrationResult> Handle(RegisterCommand request, CancellationToken cancellationToken)
    {
        if (request.Role != AccountRole.Professional) return AccountRegistrationResult.Failure(AccountRegistrationFailureReason.ProfessionalAccountRequired);
        var normalizedEmail = AccountEmail.Normalize(request.Email);
        var existing = await store.FindByEmailAsync(normalizedEmail, cancellationToken);
        if (existing is not null)
        {
            return AccountRegistrationResult.Failure(AccountRegistrationFailureReason.EmailAlreadyRegistered);
        }

        // The verifier is already the output of a slow client-side KDF (Argon2id) -- only its
        // SHA-256 is stored, never the verifier itself, so a store/backup dump cannot be
        // replayed as a login. IPasswordVerifierComparer's implementation re-hashes what the
        // client submits before comparing against this.
        var account = new Account(
            Guid.NewGuid(), normalizedEmail, request.Role, SHA256.HashData(request.PasswordVerifier), GoogleSubjectId: null,
            VerificationStatus: AccountVerificationStatus.Pending);
        await store.InsertAsync(account, cancellationToken);
        return AccountRegistrationResult.Success(account, twoFactorTicketIssuer, sessionTokenIssuer);
    }

}
