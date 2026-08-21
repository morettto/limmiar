using Mediator;

namespace Api.Accounts;

public sealed record RecoverAccessCommand(string Email, byte[] RecoveryVerifier) : IRequest<AccountRecoveryResult>;
