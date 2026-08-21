using Mediator;

namespace Api.Accounts;

public sealed record BeginTotpEnrollmentCommand(Guid AccountId) : IRequest<BeginTotpEnrollmentResult>;
