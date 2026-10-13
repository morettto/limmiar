using System.Security.Cryptography;
using Mediator;

namespace Api.Accounts;

public sealed class VerifyMagicLinkHandler(IAccountStore store, IMagicLinkIssuer magicLinkIssuer, IAnonymousPatientAccessStore accessStore)
    : IRequestHandler<VerifyMagicLinkCommand, VerifyMagicLinkResult>
{
    public async ValueTask<VerifyMagicLinkResult> Handle(VerifyMagicLinkCommand request, CancellationToken cancellationToken)
    {
        var invitation = await accessStore.FindInvitationAsync(request.Token, cancellationToken);
        if (invitation is null || (invitation.PatientAccountId is { } boundId && request.PatientAccountId is { } hint && hint != boundId))
        {
            return VerifyMagicLinkResult.Failure();
        }

        var accountId = invitation.PatientAccountId ?? request.PatientAccountId;
        var account = accountId is { } id ? await store.FindByIdAsync(id, cancellationToken) : null;
        if (accountId is not null && (account is null || account.Role != AccountRole.Patient || account.Email is not null
            || account.VerificationStatus != AccountVerificationStatus.Active || account.WebAuthnCredentialId is null
            || account.WebAuthnCosePublicKey is null || account.WebAuthnSignCount is null)) return VerifyMagicLinkResult.Failure();
        var challenge = RandomNumberGenerator.GetBytes(32);

        if (account is not null && account.WebAuthnCredentialId is not null)
        {
            var ticketData = new MagicLinkTicketData(
                invitation,
                MagicLinkCeremonyType.Assert,
                challenge,
                account.Id,
                account.WebAuthnCredentialId,
                account.WebAuthnCosePublicKey,
                account.WebAuthnSignCount);
            var ticket = magicLinkIssuer.IssueTicket(ticketData);
            return VerifyMagicLinkResult.Success(ticket, MagicLinkCeremonyType.Assert, challenge, account.WebAuthnCredentialId, account.Id);
        }

        var registrationTicketData = new MagicLinkTicketData(invitation, MagicLinkCeremonyType.Register, challenge, Guid.NewGuid());
        var registrationTicket = magicLinkIssuer.IssueTicket(registrationTicketData);
        return VerifyMagicLinkResult.Success(registrationTicket, MagicLinkCeremonyType.Register, challenge, credentialId: null, registrationTicketData.AccountId);
    }
}
