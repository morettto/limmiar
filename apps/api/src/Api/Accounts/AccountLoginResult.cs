namespace Api.Accounts;

/// <summary>
/// Deliberately the only member. A second value such as "EmailNotFound" would let
/// <c>Api.Endpoints.AuthEndpoints</c> map unknown-email and wrong-password to different
/// responses -- exactly the account-enumeration side channel
/// <see cref="AccountService.LoginAsync"/> exists to close. If a future failure reason is
/// ever needed here, confirm it can't reveal whether an e-mail is registered before
/// adding it.
/// </summary>
public enum AccountLoginFailureReason
{
    InvalidCredentials,
}

public sealed class AccountLoginResult
{
    public required bool Succeeded { get; init; }

    public Account? Account { get; init; }

    public AccountLoginFailureReason? FailureReason { get; init; }

    /// <summary>
    /// Whether this account still needs to set up, or must now complete, mandatory 2FA
    /// (Spec S02, ADR-S02-03) -- see <see cref="TwoFactorPolicy.Determine"/>. Meaningless
    /// when <see cref="Succeeded"/> is false (defaults to <see cref="TwoFactorRequirement.NotApplicable"/>).
    /// Does not itself gate login success -- the caller (HTTP layer) decides what to do
    /// with a <see cref="TwoFactorRequirement.ChallengeRequired"/>/<see cref="TwoFactorRequirement.SetupRequired"/>
    /// result; this class's own account-enumeration timing guarantee is unchanged.
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

    public static AccountLoginResult Success(Account account, string? twoFactorTicket = null, SessionTokenPair? session = null) =>
        new()
        {
            Succeeded = true,
            Account = account,
            TwoFactorRequirement = TwoFactorPolicy.Determine(account),
            TwoFactorTicket = twoFactorTicket,
            Session = session,
        };

    public static AccountLoginResult Failure(AccountLoginFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
