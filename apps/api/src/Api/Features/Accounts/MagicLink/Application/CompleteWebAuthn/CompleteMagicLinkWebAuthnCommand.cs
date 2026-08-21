using Mediator;

namespace Api.Accounts;

public sealed record CompleteMagicLinkWebAuthnCommand(
    string MagicLinkTicket,
    byte[] CredentialId,
    byte[] ClientDataJson,
    byte[]? AttestationObject,
    byte[]? AuthenticatorData,
    byte[]? Signature) : IRequest<CompleteMagicLinkResult>;
