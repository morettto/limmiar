using System.Buffers.Text;
using Mediator;

namespace Api.Accounts;

public sealed class CompleteMagicLinkWebAuthnHandler(
    IMagicLinkIssuer magicLinkIssuer,
    IWebAuthnCeremonyVerifier webAuthnCeremonyVerifier,
    IAccountStore store,
    IAnonymousPatientAccessStore accessStore,
    ISessionTokenIssuer sessionTokenIssuer,
    WebAuthnRelyingPartyOptions relyingPartyOptions) : IRequestHandler<CompleteMagicLinkWebAuthnCommand, CompleteMagicLinkResult>
{
    public async ValueTask<CompleteMagicLinkResult> Handle(CompleteMagicLinkWebAuthnCommand request, CancellationToken cancellationToken)
    {
        var ticketData = magicLinkIssuer.ConsumeTicket(request.MagicLinkTicket);
        if (ticketData is null)
        {
            return CompleteMagicLinkResult.Failure();
        }

        var expectedChallenge = Base64Url.EncodeToString(ticketData.Challenge);

        if (ticketData.CeremonyType == MagicLinkCeremonyType.Register)
        {
            if (request.AttestationObject is null)
            {
                return CompleteMagicLinkResult.Failure();
            }

            var registrationCeremony = new WebAuthnRegistrationCeremony
            {
                ExpectedChallenge = expectedChallenge,
                ExpectedRelyingPartyId = relyingPartyOptions.RelyingPartyId,
                ExpectedOrigin = relyingPartyOptions.ExpectedOrigin,
                CredentialId = request.CredentialId,
                ClientDataJson = request.ClientDataJson,
                AttestationObject = request.AttestationObject,
            };

            var registrationResult = await webAuthnCeremonyVerifier.VerifyRegistrationAsync(registrationCeremony, cancellationToken);
            if (!registrationResult.Succeeded)
            {
                return CompleteMagicLinkResult.Failure();
            }

            var credential = registrationResult.Credential!;
            var newAccount = new Account(
                ticketData.AccountId,
                null,
                AccountRole.Patient,
                PasswordVerifier: null,
                GoogleSubjectId: null,
                VerificationStatus: AccountVerificationStatus.Active,
                WebAuthnCredentialId: credential.CredentialId,
                WebAuthnCosePublicKey: credential.CosePublicKey,
                WebAuthnSignCount: credential.SignCount,
                WebAuthnAaGuid: credential.AaGuid);
            if (!await accessStore.RegisterAsync(ticketData.Invitation, newAccount, cancellationToken)) return CompleteMagicLinkResult.Failure();
            return CompleteMagicLinkResult.Success(newAccount, sessionTokenIssuer.IssuePair(newAccount.Id));
        }

        if (request.AuthenticatorData is null || request.Signature is null
            || ticketData.CredentialId is null || ticketData.StoredCosePublicKey is null || ticketData.StoredSignCount is null)
        {
            return CompleteMagicLinkResult.Failure();
        }

        var account = await store.FindByIdAsync(ticketData.AccountId, cancellationToken);
        if (account is null || account.Role != AccountRole.Patient || account.Email is not null
            || account.VerificationStatus != AccountVerificationStatus.Active
            || !request.CredentialId.AsSpan().SequenceEqual(ticketData.CredentialId))
        {
            return CompleteMagicLinkResult.Failure();
        }

        var assertionCeremony = new WebAuthnAssertionCeremony
        {
            ExpectedChallenge = expectedChallenge,
            ExpectedRelyingPartyId = relyingPartyOptions.RelyingPartyId,
            ExpectedOrigin = relyingPartyOptions.ExpectedOrigin,
            CredentialId = ticketData.CredentialId,
            StoredCosePublicKey = ticketData.StoredCosePublicKey,
            StoredSignCount = ticketData.StoredSignCount.Value,
            ClientDataJson = request.ClientDataJson,
            AuthenticatorData = request.AuthenticatorData,
            Signature = request.Signature,
        };

        var assertionResult = await webAuthnCeremonyVerifier.VerifyAssertionAsync(assertionCeremony, cancellationToken);
        if (!assertionResult.Succeeded)
        {
            return CompleteMagicLinkResult.Failure();
        }

        var updatedAccount = account with { WebAuthnSignCount = assertionResult.NewSignCount };
        if (!await accessStore.AssertAsync(ticketData.Invitation, updatedAccount, ticketData.StoredSignCount.Value, cancellationToken))
            return CompleteMagicLinkResult.Failure();
        return CompleteMagicLinkResult.Success(updatedAccount, sessionTokenIssuer.IssuePair(updatedAccount.Id));
    }
}
