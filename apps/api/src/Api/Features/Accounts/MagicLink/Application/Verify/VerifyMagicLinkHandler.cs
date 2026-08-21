using System.Security.Cryptography;
using Mediator;

namespace Api.Accounts;

public sealed class VerifyMagicLinkHandler(IAccountStore store, IMagicLinkIssuer magicLinkIssuer)
    : IRequestHandler<VerifyMagicLinkCommand, VerifyMagicLinkResult>
{
    public async ValueTask<VerifyMagicLinkResult> Handle(VerifyMagicLinkCommand request, CancellationToken cancellationToken)
    {
        var email = magicLinkIssuer.ConsumeToken(request.Token);
        if (email is null)
        {
            return VerifyMagicLinkResult.Failure();
        }

        var account = await store.FindByEmailAsync(email, cancellationToken);
        var challenge = RandomNumberGenerator.GetBytes(32);

        if (account is not null && account.WebAuthnCredentialId is not null)
        {
            var ticketData = new MagicLinkTicketData(
                email,
                MagicLinkCeremonyType.Assert,
                challenge,
                account.Id,
                account.WebAuthnCredentialId,
                account.WebAuthnCosePublicKey,
                account.WebAuthnSignCount);
            var ticket = magicLinkIssuer.IssueTicket(ticketData);
            return VerifyMagicLinkResult.Success(ticket, MagicLinkCeremonyType.Assert, challenge, account.WebAuthnCredentialId);
        }

        var registrationTicketData = new MagicLinkTicketData(email, MagicLinkCeremonyType.Register, challenge);
        var registrationTicket = magicLinkIssuer.IssueTicket(registrationTicketData);
        return VerifyMagicLinkResult.Success(registrationTicket, MagicLinkCeremonyType.Register, challenge, credentialId: null);
    }
}
