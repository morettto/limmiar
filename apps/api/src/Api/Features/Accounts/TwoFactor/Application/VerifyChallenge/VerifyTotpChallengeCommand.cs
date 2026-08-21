using Mediator;

namespace Api.Accounts;

public sealed record VerifyTotpChallengeCommand(Guid AccountId, string? Code, string? BackupCode) : IRequest<VerifyTotpChallengeResult>;
