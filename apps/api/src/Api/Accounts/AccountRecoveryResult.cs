namespace Api.Accounts;

/// <summary>
/// Deliberately the only member -- same account-enumeration-mitigation discipline as
/// <see cref="AccountLoginFailureReason"/>. An unknown e-mail, an account that never
/// registered a recovery phrase, and a wrong recovery verifier must all be
/// indistinguishable to a caller. See <see cref="AccountService.RecoverAccessAsync"/>.
/// </summary>
public enum AccountRecoveryFailureReason
{
    InvalidRecoveryPhrase,
}

public sealed class AccountRecoveryResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public AccountRecoveryFailureReason? FailureReason { get; init; }

    /// <summary>
    /// Whether this account still needs to set up, or must now complete, mandatory 2FA
    /// (Spec S02, ADR-S02-03) -- see <see cref="TwoFactorPolicy.Determine"/>. Meaningless
    /// when <see cref="Succeeded"/> is false (defaults to <see cref="TwoFactorRequirement.NotApplicable"/>).
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
    /// -- see <see cref="AccountLoginResult.Session"/> for why.
    /// </summary>
    public SessionTokenPair? Session { get; init; }

    public static AccountRecoveryResult Success(Account account, string? twoFactorTicket = null, SessionTokenPair? session = null) =>
        new()
        {
            Succeeded = true,
            Account = account,
            TwoFactorRequirement = TwoFactorPolicy.Determine(account),
            TwoFactorTicket = twoFactorTicket,
            Session = session,
        };

    public static AccountRecoveryResult Failure(AccountRecoveryFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
