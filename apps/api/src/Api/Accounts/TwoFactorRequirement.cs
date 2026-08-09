using System.Text.Json.Serialization;

namespace Api.Accounts;

/// <summary>
/// Whether -- and at which stage -- an account must go through TOTP two-factor
/// authentication (Spec S02, ADR-S02-03/S02-04). Mandatory for every
/// <see cref="AccountRole.Professional"/> account and cannot be skipped; never applies to
/// <see cref="AccountRole.Patient"/> accounts. See <see cref="TwoFactorPolicy.Determine"/>.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<TwoFactorRequirement>))]
public enum TwoFactorRequirement
{
    /// <summary>2FA does not apply to this account -- always the case for <see cref="AccountRole.Patient"/>.</summary>
    NotApplicable,

    /// <summary>
    /// A <see cref="AccountRole.Professional"/> account that has never confirmed a TOTP
    /// enrollment (<see cref="Account.TotpEnabledAt"/> is null). Must complete
    /// <see cref="AccountService.BeginTotpEnrollmentAsync"/> then
    /// <see cref="AccountService.ConfirmTotpEnrollmentAsync"/> before it can be considered
    /// fully authenticated.
    /// </summary>
    SetupRequired,

    /// <summary>
    /// A <see cref="AccountRole.Professional"/> account that already confirmed a TOTP
    /// enrollment. Must pass <see cref="AccountService.VerifyTotpChallengeAsync"/> (an
    /// authenticator code or a single-use backup code) on every login.
    /// </summary>
    ChallengeRequired,
}
