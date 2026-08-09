namespace Api.Accounts;

/// <summary>
/// Issues and rotates the access/refresh token pair that stands in for a real session once
/// an account finishes logging in (Spec S02, ticket S02-08 -- "the ticket that owns the
/// mechanic of sessions after login," not S02-01, which only covers the A1 screen +
/// cadastro itself). NOT wired into any endpoint's authorization check yet -- there is no
/// consumer in this ticket's scope; <see cref="ValidateAccess"/> exists as a ready-to-call
/// seam for whichever ticket needs one next (same "build the piece before its consumer
/// exists" precedent as <see cref="AccountAuthorizationGuard"/>, which still waits on
/// S03-01).
/// </summary>
public interface ISessionTokenIssuer
{
    /// <summary>
    /// Issues a brand-new access/refresh pair under a brand-new session family for
    /// <paramref name="accountId"/>. Called once per login (register/login/Google when no
    /// 2FA is pending, or TOTP confirm/challenge when it is) -- never mid-family; mid-family
    /// rotation is <see cref="Refresh"/>'s job.
    /// </summary>
    SessionTokenPair IssuePair(Guid accountId);

    /// <summary>
    /// Rotates a refresh token: burns <paramref name="refreshToken"/> and, if it was valid
    /// and unused, issues a fresh pair under the SAME session family. Presenting a token
    /// that was already burned by an earlier call revokes the entire family (every token
    /// that family ever issued, including ones never yet used) -- the specific signal that
    /// a stolen copy of that exact token is in circulation.
    /// </summary>
    RefreshSessionResult Refresh(string refreshToken);

    /// <summary>
    /// Resolves an access token to the account it was issued for, or null if the token was
    /// never issued, has expired, or belongs to a revoked family. No endpoint calls this in
    /// this ticket's scope -- see the type's own doc comment.
    /// </summary>
    Guid? ValidateAccess(string accessToken);
}
