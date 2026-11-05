using Mediator;

namespace Api.Accounts;

public sealed record RegisterRecoveryVerifierCommand(Guid AccountId, byte[] RecoveryVerifier) : IRequest<RegisterRecoveryVerifierResult>;
