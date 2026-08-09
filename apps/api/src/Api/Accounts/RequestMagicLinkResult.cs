namespace Api.Accounts;

/// <summary>
/// Deliberately carries no data at all -- <see cref="AccountService.RequestMagicLinkAsync"/>
/// always "succeeds" outwardly (account-enumeration mitigation, same discipline as
/// <see cref="AccountService.LoginAsync"/>'s doc comment), so a type with a
/// <c>Succeeded</c>/<c>FailureReason</c> shape like every other result in this file would
/// invite a caller to branch on something that must never differ. There is nothing this type
/// could carry that wouldn't risk becoming that oracle.
/// </summary>
public sealed record RequestMagicLinkResult
{
    public static readonly RequestMagicLinkResult Instance = new();
}
