using Mediator;

namespace Api.Accounts;

public sealed record RequestMagicLinkCommand(string Email) : IRequest<RequestMagicLinkResult>;
