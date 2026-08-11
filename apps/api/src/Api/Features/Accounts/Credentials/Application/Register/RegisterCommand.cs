using Mediator;

namespace Api.Accounts;

public sealed record RegisterCommand(string Email, byte[] PasswordVerifier, AccountRole Role) : IRequest<AccountRegistrationResult>;
