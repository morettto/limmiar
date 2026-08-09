namespace Api.Accounts;

public enum AccountRegistrationFailureReason
{
    EmailAlreadyRegistered,
}

public sealed class AccountRegistrationResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public AccountRegistrationFailureReason? FailureReason { get; init; }

    /// <summary>
    /// Whether the new account still needs to set up mandatory 2FA (Spec S02,
    /// ADR-S02-03) -- see <see cref="TwoFactorPolicy.Determine"/>. Meaningless when
    /// <see cref="Succeeded"/> is false (defaults to <see cref="TwoFactorRequirement.NotApplicable"/>).
    /// </summary>
    public TwoFactorRequirement TwoFactorRequirement { get; init; }

    /// <summary>
    /// Opaque proof (see <see cref="ITwoFactorTicketIssuer"/>) that this exact call
    /// verified this account's identity -- required by the TOTP begin/confirm/challenge
    /// endpoints. Null when <see cref="TwoFactorRequirement"/> is
    /// <see cref="TwoFactorRequirement.NotApplicable"/>; always set otherwise.
    /// </summary>
    public string? TwoFactorTicket { get; init; }

    /// <summary>
    /// The session issued by this call (Spec S02, ticket S02-08), or null when
    /// <see cref="TwoFactorRequirement"/> isn't <see cref="TwoFactorRequirement.NotApplicable"/>
    /// -- a professional account that still owes 2FA is not logged in yet, so no session
    /// exists until <see cref="AccountService.ConfirmTotpEnrollmentAsync"/> or
    /// <see cref="AccountService.VerifyTotpChallengeAsync"/> completes it.
    /// </summary>
    public SessionTokenPair? Session { get; init; }

    public static AccountRegistrationResult Success(Account account, string? twoFactorTicket = null, SessionTokenPair? session = null) =>
        new()
        {
            Succeeded = true,
            Account = account,
            TwoFactorRequirement = TwoFactorPolicy.Determine(account),
            TwoFactorTicket = twoFactorTicket,
            Session = session,
        };

    public static AccountRegistrationResult Failure(AccountRegistrationFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
