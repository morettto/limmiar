using System.Text.Json.Serialization;

namespace Api.Accounts;

/// <summary>
/// Whether a burned magic-link token (<see cref="IMagicLinkIssuer.ConsumeToken"/>) resolved
/// to an e-mail with no registered WebAuthn credential yet -- so the next step is
/// <c>navigator.credentials.create()</c> -- or to one that already has one, so the next step
/// is <c>navigator.credentials.get()</c>.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<MagicLinkCeremonyType>))]
public enum MagicLinkCeremonyType
{
    /// <summary>No account (or no credential on an existing account -- see <see cref="Account.WebAuthnCredentialId"/>) exists for this e-mail yet. The next call registers one and creates the account.</summary>
    Register,

    /// <summary>An account with a registered credential already exists for this e-mail. The next call re-asserts it.</summary>
    Assert,
}

/// <summary>
/// Everything <see cref="AccountService.CompleteMagicLinkWebAuthnAsync"/> needs to build the
/// matching <see cref="WebAuthnRegistrationCeremony"/>/<see cref="WebAuthnAssertionCeremony"/>
/// -- minted by <see cref="IMagicLinkIssuer.IssueTicket"/> once
/// <see cref="AccountService.VerifyMagicLinkAsync"/> has burned the e-mail-ownership token and
/// decided which ceremony applies. This is the bridge between "proved you own this e-mail"
/// and "now prove this device via WebAuthn" -- same role as
/// <see cref="ITwoFactorTicketIssuer"/>'s tickets, but carrying WebAuthn ceremony inputs
/// instead of a bare account id, since the assertion path needs the stored credential
/// material to build its ceremony.
/// </summary>
/// <param name="Email">The e-mail the original token was issued for.</param>
/// <param name="CeremonyType">Which of the two WebAuthn ceremonies this ticket authorizes.</param>
/// <param name="Challenge">
/// The random challenge <see cref="AccountService.VerifyMagicLinkAsync"/> generated for this
/// attempt, in raw bytes. The caller re-derives the base64url form the ceremony verifier
/// expects (<see cref="WebAuthnRegistrationCeremony.ExpectedChallenge"/>) from these same
/// bytes, rather than storing the string twice.
/// </param>
/// <param name="AccountId">Set only for <see cref="MagicLinkCeremonyType.Assert"/> -- the account whose credential this ticket re-asserts.</param>
/// <param name="CredentialId">Set only for <see cref="MagicLinkCeremonyType.Assert"/> -- <see cref="Account.WebAuthnCredentialId"/> as it stood when the ticket was issued.</param>
/// <param name="StoredCosePublicKey">Set only for <see cref="MagicLinkCeremonyType.Assert"/> -- <see cref="Account.WebAuthnCosePublicKey"/> as it stood when the ticket was issued.</param>
/// <param name="StoredSignCount">Set only for <see cref="MagicLinkCeremonyType.Assert"/> -- <see cref="Account.WebAuthnSignCount"/> as it stood when the ticket was issued.</param>
public sealed record MagicLinkTicketData(
    string Email,
    MagicLinkCeremonyType CeremonyType,
    byte[] Challenge,
    Guid? AccountId = null,
    byte[]? CredentialId = null,
    byte[]? StoredCosePublicKey = null,
    uint? StoredSignCount = null);
