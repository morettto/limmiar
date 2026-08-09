namespace Api.Accounts;

/// <summary>
/// Two chained single-use, short-TTL opaque credentials that together carry a patient
/// through S02-05's magic-link + WebAuthn login: a token proving e-mail ownership
/// (<see cref="IssueToken"/>/<see cref="ConsumeToken"/>), and a ticket
/// (<see cref="IssueTicket"/>/<see cref="ConsumeTicket"/>) proving that token was already
/// burned, minted so the subsequent WebAuthn ceremony doesn't have to re-derive what the
/// token already established. Both live in the same interface (rather than two issuers)
/// because they share identical expiry/single-use bookkeeping, which a single implementation
/// only needs to get right once.
/// </summary>
public interface IMagicLinkIssuer
{
    /// <summary>Issues a fresh, opaque token bound to <paramref name="email"/>.</summary>
    string IssueToken(string email);

    /// <summary>
    /// Burns <paramref name="token"/> and returns the e-mail it was bound to, or null.
    ///
    /// Null covers every failure reason -- never issued, expired, or already consumed --
    /// collapsed into one outcome on purpose (mirrors
    /// <c>Api.Problems.ProblemCodes.AuthRefreshTokenInvalid</c>'s reasoning): a caller that
    /// could tell "this token never existed" apart from "this token was already used" would
    /// have a free oracle for guessing valid tokens or confirming a magic link was already
    /// clicked. A token is removed from storage the instant this is called, valid or not, so
    /// it can never be presented a second time either way.
    /// </summary>
    string? ConsumeToken(string token);

    /// <summary>Issues a fresh, opaque ticket carrying <paramref name="ticket"/>.</summary>
    string IssueTicket(MagicLinkTicketData ticket);

    /// <summary>
    /// Burns a ticket and returns the data it carried, or null. Same one-outcome-for-every-failure
    /// collapse as <see cref="ConsumeToken"/>, for the same reason -- this ticket sits directly
    /// in front of a live WebAuthn ceremony, so telling "unknown" apart from "expired" or
    /// "already used" would hand an attacker probing it exactly the oracle
    /// <c>Api.Problems.ProblemCodes.AuthWebAuthnCeremonyFailed</c> exists to deny.
    /// </summary>
    MagicLinkTicketData? ConsumeTicket(string ticket);
}
