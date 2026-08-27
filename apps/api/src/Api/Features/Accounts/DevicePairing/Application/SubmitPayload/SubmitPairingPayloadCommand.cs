using Mediator;

namespace Api.Accounts;

public sealed record SubmitPairingPayloadCommand(string SessionId, Guid AccountId, byte[] EncryptedKek) : IRequest<SubmitPairingPayloadResult>;
