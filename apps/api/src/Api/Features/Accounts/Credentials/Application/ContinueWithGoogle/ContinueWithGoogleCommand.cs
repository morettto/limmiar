using Api.Platform;
using Mediator;

namespace Api.Accounts;

public sealed record ContinueWithGoogleCommand(string IdToken, AccountRole RequestedRole) : IRequest<Result<AccountGoogleAuthSuccess, AccountGoogleAuthFailureReason>>;
