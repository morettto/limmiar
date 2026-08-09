namespace Api.Accounts;

/// <summary>
/// Short-lived, single-account proof that a caller already passed
/// <see cref="AccountService.RegisterAsync"/>, <see cref="AccountService.LoginAsync"/>, or
/// <see cref="AccountService.GoogleAuthAsync"/> for a specific account -- NOT a full
/// session/token (that is S02-08's scope). Exists solely to close the account-takeover gap
/// where <c>Api.Endpoints.TwoFactorEndpoints</c> used to trust an <c>accountId</c> from the
/// URL alone: without this, anyone who could guess/discover a professional's accountId
/// could enroll or confirm TOTP for that account, or "authenticate" via the challenge
/// endpoint, with no proof they ever passed a password/Google check for that account.
/// </summary>
public interface ITwoFactorTicketIssuer
{
    /// <summary>Issues a fresh, opaque ticket bound to <paramref name="accountId"/>.</summary>
    string Issue(Guid accountId);

    /// <summary>
    /// True only if <paramref name="ticket"/> was issued, has not expired, and was issued
    /// for exactly <paramref name="accountId"/> -- a ticket minted for a different account
    /// must never validate here (this is the specific check that closes the
    /// account-takeover vulnerability: the ticket is account-scoped, not just a generic
    /// "someone logged in recently" flag).
    /// </summary>
    bool Validate(string ticket, Guid accountId);

    /// <summary>
    /// Removes the ticket so it cannot be reused. Callers invalidate a ticket once the
    /// 2FA flow step it was proving is complete (TOTP enrollment confirmed, or a login
    /// challenge passed) -- the ticket must not outlive that single use.
    /// </summary>
    void Invalidate(string ticket);
}
