using Mediator;

namespace Api.Accounts;

public sealed record VerifyMagicLinkCommand(string Token) : IRequest<VerifyMagicLinkResult>;
