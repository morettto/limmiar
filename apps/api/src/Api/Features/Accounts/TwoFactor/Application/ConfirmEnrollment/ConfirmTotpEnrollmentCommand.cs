using Mediator;

namespace Api.Accounts;

public sealed record ConfirmTotpEnrollmentCommand(Guid AccountId, string Code) : IRequest<ConfirmTotpEnrollmentResult>;
