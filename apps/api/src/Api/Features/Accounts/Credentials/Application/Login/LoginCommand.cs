using Mediator;

namespace Api.Accounts;

public sealed record LoginCommand(string Email, byte[] PasswordVerifier) : IRequest<AccountLoginResult>;
