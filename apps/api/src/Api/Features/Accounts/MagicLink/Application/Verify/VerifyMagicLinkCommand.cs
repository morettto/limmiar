using Mediator;

namespace Api.Accounts;

public sealed record VerifyMagicLinkCommand(string Token, Guid? PatientAccountId = null) : IRequest<VerifyMagicLinkResult>;
