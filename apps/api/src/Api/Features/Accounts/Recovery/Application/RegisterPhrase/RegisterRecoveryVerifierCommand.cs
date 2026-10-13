using Mediator;

namespace Api.Accounts;

public sealed record RegisterRecoveryVerifierCommand(Guid AccountId, byte[] RecoveryVerifier, byte[] RecoveryEnvelope) : IRequest<RegisterRecoveryVerifierResult>;
