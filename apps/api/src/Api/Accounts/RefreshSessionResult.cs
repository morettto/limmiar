namespace Api.Accounts;

/// <summary>
/// Deliberately the only member. A refresh token can fail to validate for several distinct
/// internal reasons (never issued, expired, belongs to an already-revoked family, or reuse
/// of an already-burned token -- which additionally revokes the family as a side effect),
/// but <see cref="Api.Endpoints.AuthEndpoints"/> must map every one of them to the exact
/// same response: telling a caller WHY a token didn't work would let anyone testing stolen
/// refresh tokens distinguish "wrong guess" from "this one was real but got burned by reuse
/// detection" -- the same account-enumeration-style discipline
/// <see cref="AccountService.LoginAsync"/> already applies to e-mail/password. If a second
/// value is ever needed here, confirm it can't leak that distinction before adding it.
/// </summary>
public enum RefreshSessionFailureReason
{
    InvalidToken,
}

public sealed class RefreshSessionResult
{
    public required bool Succeeded { get; init; }

    public SessionTokenPair? TokenPair { get; init; }

    public RefreshSessionFailureReason? FailureReason { get; init; }

    public static RefreshSessionResult Success(SessionTokenPair tokenPair) =>
        new() { Succeeded = true, TokenPair = tokenPair };

    public static RefreshSessionResult Failure() =>
        new() { Succeeded = false, FailureReason = RefreshSessionFailureReason.InvalidToken };
}
