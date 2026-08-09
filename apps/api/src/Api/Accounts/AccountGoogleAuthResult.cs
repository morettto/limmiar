namespace Api.Accounts;

public enum AccountGoogleAuthFailureReason
{
    InvalidGoogleToken,
}

public sealed class AccountGoogleAuthResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    /// <summary>
    /// True when this call created a brand-new account; false when it resolved to an
    /// account that already existed for this Google identity's e-mail (ADR-S02-01: role
    /// resolved automatically, no re-prompt). Meaningless when <see cref="Succeeded"/> is
    /// false.
    /// </summary>
    public bool IsNewAccount { get; init; }

    public AccountGoogleAuthFailureReason? FailureReason { get; init; }

    /// <summary>
    /// Whether this account still needs to set up mandatory 2FA (Spec S02, ADR-S02-03) --
    /// see <see cref="TwoFactorPolicy.Determine"/>. Meaningless when <see cref="Succeeded"/>
    /// is false (defaults to <see cref="TwoFactorRequirement.NotApplicable"/>).
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
    /// -- see <see cref="AccountRegistrationResult.Session"/> for why.
    /// </summary>
    public SessionTokenPair? Session { get; init; }

    public static AccountGoogleAuthResult Success(Account account, bool isNewAccount, string? twoFactorTicket = null, SessionTokenPair? session = null) =>
        new()
        {
            Succeeded = true,
            Account = account,
            IsNewAccount = isNewAccount,
            TwoFactorRequirement = TwoFactorPolicy.Determine(account),
            TwoFactorTicket = twoFactorTicket,
            Session = session,
        };

    public static AccountGoogleAuthResult Failure(AccountGoogleAuthFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
