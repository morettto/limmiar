namespace Api.Accounts;

/// <summary>
/// A registered account. <see cref="PasswordVerifier"/> is null for accounts created
/// exclusively through Google sign-in that have never set an e-mail/password credential
/// (ADR-S02-02: the server only ever stores the client-derived verifier, never a
/// password). <see cref="GoogleSubjectId"/> is null for accounts created through e-mail
/// registration that have never linked Google.
///
/// <see cref="VerificationStatus"/> defaults to <see cref="AccountVerificationStatus.Active"/>
/// only so existing call sites (mostly tests seeding <see cref="AccountRole.Patient"/>
/// accounts, which are always Active) don't need updating -- <see cref="AccountService"/>
/// always sets it explicitly for every account it creates (S02-02: Active for Patient,
/// Pending for Professional). <see cref="RejectionReason"/> and
/// <see cref="VerificationSubmittedAt"/> are only meaningful while
/// <see cref="VerificationStatus"/> is, respectively, <see cref="AccountVerificationStatus.Rejected"/>
/// and <see cref="AccountVerificationStatus.InReview"/>.
/// </summary>
public sealed record Account(
    Guid Id,
    string Email,
    AccountRole Role,
    byte[]? PasswordVerifier,
    string? GoogleSubjectId,
    AccountVerificationStatus VerificationStatus = AccountVerificationStatus.Active,
    string? RejectionReason = null,
    DateTimeOffset? VerificationSubmittedAt = null,
    /// <summary>
    /// Base32 TOTP secret, in clear -- same placeholder fidelity as the rest of this
    /// in-memory record (see <see cref="InMemoryAccountStore"/>'s own TODO). The future
    /// Postgres-backed implementation MUST envelope this field with the S01 crypto (see
    /// packages/crypto) before it ever reaches production; storing it in clear there would
    /// hand out every professional's 2FA seed to anyone with database access. Null until
    /// <see cref="AccountService.BeginTotpEnrollmentAsync"/> is first called.
    /// </summary>
    string? TotpSecret = null,
    /// <summary>
    /// Null means either "enrollment never started" (<see cref="TotpSecret"/> also null) or
    /// "enrollment pending confirmation" (<see cref="TotpSecret"/> set, waiting on
    /// <see cref="AccountService.ConfirmTotpEnrollmentAsync"/>). Set once, at confirmation
    /// time, and never cleared again -- there is deliberately no reset/disable path
    /// (ADR-S02-04).
    /// </summary>
    DateTimeOffset? TotpEnabledAt = null,
    /// <summary>
    /// SHA-256 hex hashes (see <see cref="BackupCodeGenerator.Hash"/>) of the still-unused
    /// backup codes issued at enrollment confirmation. Single-use: a hash is removed from
    /// this list the moment its code is consumed by
    /// <see cref="AccountService.VerifyTotpChallengeAsync"/>.
    /// </summary>
    IReadOnlyList<string>? TotpBackupCodeHashes = null,
    /// <summary>
    /// The one WebAuthn platform-authenticator credential a patient account can register
    /// (S02-05: magic-link + biometric login). Null until
    /// <see cref="AccountService.CompleteMagicLinkWebAuthnAsync"/> completes a REGISTRATION
    /// ceremony for this account -- which today happens exactly once, at account creation
    /// time (a magic link for an e-mail with no existing credential always creates the
    /// account and registers the credential together), so <see cref="WebAuthnCredentialId"/>,
    /// <see cref="WebAuthnCosePublicKey"/>, <see cref="WebAuthnSignCount"/> and
    /// <see cref="WebAuthnAaGuid"/> are set or null as a group.
    ///
    /// Flattened onto this record (like <see cref="TotpSecret"/>/<see cref="TotpEnabledAt"/>/
    /// <see cref="TotpBackupCodeHashes"/>) rather than embedding
    /// <see cref="WebAuthnCredentialRegistration"/> as a single nested property: every other
    /// optional per-feature group on this record is already flat, and a lone nested record
    /// here would be the only field whose `with`-update needs a second level of property
    /// access, unlike the flat `account with { WebAuthnSignCount = ... }` this class uses for
    /// every other in-place update (see <see cref="AccountService.VerifyTotpChallengeAsync"/>
    /// for the TOTP precedent this mirrors).
    /// </summary>
    byte[]? WebAuthnCredentialId = null,
    byte[]? WebAuthnCosePublicKey = null,
    uint? WebAuthnSignCount = null,
    Guid? WebAuthnAaGuid = null,
    /// <summary>
    /// Client-derived verifier for the BIP39 recovery phrase issued to a
    /// <see cref="AccountRole.Professional"/> account (Spec S02, ticket S02-06). Same
    /// "server only ever stores a derived verifier, never the secret itself" contract as
    /// <see cref="PasswordVerifier"/> (ADR-S02-02) -- the 32-byte length matches
    /// <see cref="AccountService.PasswordVerifierLength"/>. Null until
    /// <see cref="AccountService.RegisterRecoveryVerifierAsync"/> is first called; every
    /// later call overwrites it (rotation via re-registration, no reset-then-set step).
    /// </summary>
    byte[]? RecoveryVerifier = null);
