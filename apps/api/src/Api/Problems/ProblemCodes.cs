namespace Api.Problems;

/// <summary>Stable, machine-readable error codes returned in <see cref="LimmiarProblemDetails.Code"/>.</summary>
public static class ProblemCodes
{
    public const string HealthDatabaseUnreachable = "health.database_unreachable";

    /// <summary>Fallback code for any exception not otherwise mapped to a specific problem code.</summary>
    public const string UnexpectedError = "unexpected_error";

    /// <summary>Request body failed a field-level validation check (e.g. missing/malformed field).</summary>
    public const string ValidationInvalidField = "validation.invalid_field";

    public const string AuthEmailAlreadyRegistered = "auth.email_already_registered";

    /// <summary>
    /// Returned for BOTH "no account with this e-mail" and "wrong password verifier" --
    /// deliberately the same code (and same status, title, body shape) for both, so a
    /// caller cannot tell them apart. See AccountService.LoginAsync.
    /// </summary>
    public const string AuthInvalidCredentials = "auth.invalid_credentials";

    public const string AuthGoogleTokenInvalid = "auth.google_token_invalid";

    public const string AuthAccountNotFound = "auth.account_not_found";

    public const string AuthNotAProfessionalAccount = "auth.not_a_professional_account";

    /// <summary>
    /// Professional-verification submission rejected because the account isn't in a state
    /// that accepts one (see <c>SubmitProfessionalCredentialFailureReason.InvalidStateForSubmission</c>).
    /// </summary>
    public const string AuthInvalidVerificationState = "auth.invalid_verification_state";

    /// <summary>A verification decision was attempted on an account that isn't <c>InReview</c>.</summary>
    public const string AuthNotInReview = "auth.not_in_review";

    /// <summary>TOTP enrollment was requested for an account that already confirmed one (Spec S02, ADR-S02-03).</summary>
    public const string AuthTotpAlreadyEnabled = "auth.totp_already_enabled";

    /// <summary>TOTP confirmation/other pending-enrollment action attempted with no enrollment pending.</summary>
    public const string AuthTotpNotPending = "auth.totp_not_pending";

    /// <summary>A submitted TOTP code or backup code did not validate.</summary>
    public const string AuthTotpInvalidCode = "auth.totp_invalid_code";

    /// <summary>A TOTP challenge was attempted against an account that never confirmed an enrollment.</summary>
    public const string AuthTotpNotEnabled = "auth.totp_not_enabled";

    /// <summary>
    /// A TOTP begin/confirm/challenge call was missing a valid two-factor ticket for the
    /// target account (security-review finding: these endpoints used to trust the
    /// <c>accountId</c> URL segment alone). See <c>Api.Accounts.ITwoFactorTicketIssuer</c>.
    /// </summary>
    public const string AuthTotpTicketInvalid = "auth.totp_ticket_invalid";

    /// <summary>
    /// A staff/reviewer-only endpoint was called without a valid staff API key (security-review
    /// finding: professional-verification review endpoints had no authentication at all).
    /// See <c>Api.Accounts.IStaffAccessGuard</c>.
    /// </summary>
    public const string StaffUnauthorized = "staff.unauthorized";

    /// <summary>
    /// A refresh token was rejected by <c>POST /auth/refresh</c> -- never issued, expired,
    /// or reuse-detected (which additionally revokes the entire session family). Always the
    /// same code for all three, on purpose: see <c>Api.Accounts.RefreshSessionResult</c>.
    /// </summary>
    public const string AuthRefreshTokenInvalid = "auth.refresh_token_invalid";

    /// <summary>
    /// Security-review finding (S02-08, applied retroactively to S02-02's already-Done
    /// professional-verification submission endpoint): missing/invalid/expired
    /// <c>Authorization: Bearer</c> access token, or one that resolves to a DIFFERENT
    /// account than the <c>accountId</c> URL segment. Same "one code regardless of which
    /// specific reason" discipline as <see cref="AuthRefreshTokenInvalid"/>.
    /// </summary>
    public const string AuthAccessTokenInvalid = "auth.access_token_invalid";

    /// <summary>
    /// A device-pairing session id (S02-04) did not resolve: never issued, expired, already
    /// claimed by another device, or -- for the account-scoped operations -- belonging to a
    /// different account than the caller. Deliberately one code and one status for all of
    /// them. A session id is an opaque 256-bit token rather than something
    /// account-identifying, so this is not the same credential-guessing concern as login,
    /// but the discipline is applied anyway, for consistency with
    /// <see cref="AuthRefreshTokenInvalid"/> and because distinguishing "never real" from
    /// "real, someone beat you to it" is exactly the oracle a stolen-QR attack wants. See
    /// <c>Api.Accounts.ClaimPairingSessionFailureReason</c>.
    /// </summary>
    public const string DevicePairingSessionNotFound = "auth.device_pairing_session_not_found";

    /// <summary>
    /// The primary device tried to submit its encrypted KEK for a pairing session that is
    /// real and belongs to it, but is not accepting one right now -- either no device has
    /// scanned the QR code yet, or a payload was already submitted (one handshake, one
    /// ciphertext). One code for both: the caller-facing meaning is identical, "you cannot
    /// submit right now". Distinct from <see cref="DevicePairingSessionNotFound"/>, which is
    /// about the session not resolving at all.
    /// </summary>
    public const string DevicePairingPayloadNotReady = "auth.device_pairing_payload_not_ready";

    /// <summary>
    /// The claiming device asked for the encrypted KEK and there is none to hand over:
    /// the session is unknown or expired, OR the primary has not submitted a payload yet,
    /// OR the payload was already fetched once (a successful fetch consumes the session).
    /// Deliberately one code for all three -- callers are expected to simply retry on this
    /// exact code until they get the ciphertext, and telling the reasons apart would only
    /// let someone replaying a session id learn whether it was ever real and whether they
    /// arrived too late. See <c>Api.Accounts.FetchPairingPayloadFailureReason</c>.
    /// </summary>
    public const string DevicePairingPayloadNotDelivered = "auth.device_pairing_payload_not_delivered";

    /// <summary>
    /// A magic-link token was rejected by <c>POST /auth/magic-link/verify</c> -- never
    /// issued, expired, or already used. Always the same code for all three (see
    /// <c>Api.Accounts.MagicLinkIssuer.ConsumeToken</c>), same discipline as
    /// <see cref="AuthRefreshTokenInvalid"/>: telling the reasons apart would let a caller
    /// probe whether a given token, or the e-mail behind it, was ever real.
    /// </summary>
    public const string AuthMagicLinkInvalid = "auth.magic_link_invalid";

    /// <summary>
    /// A WebAuthn registration/assertion ceremony rejected by
    /// <c>POST /auth/magic-link/webauthn/complete</c> (S02-05). Collapses every possible
    /// reason -- an invalid/expired/already-used <c>magicLinkTicket</c>, plus every
    /// <c>Api.Accounts.WebAuthnCeremonyFailureReason</c> the underlying verifier can produce
    /// (malformed response, wrong challenge/origin/relying-party id, missing user presence
    /// or verification, unsupported algorithm, bad signature, non-advancing sign count) --
    /// into one code and one status. Same discipline as <see cref="AuthMagicLinkInvalid"/>
    /// and <see cref="AuthRefreshTokenInvalid"/>: this sits directly in front of a live
    /// biometric authentication ceremony, and distinguishing why it failed would hand an
    /// attacker a free oracle for probing it.
    /// </summary>
    public const string AuthWebAuthnCeremonyFailed = "auth.webauthn_ceremony_failed";

    /// <summary>
    /// Returned for every failure reason <c>POST /auth/recover</c> can hit -- an unknown
    /// e-mail, an account that never registered a recovery phrase, and a wrong recovery
    /// verifier -- deliberately the same code (and same status, title, body shape) for all
    /// three, so a caller cannot tell them apart. Same discipline as
    /// <see cref="AuthInvalidCredentials"/>; see <c>Api.Accounts.AccountService.RecoverAccessAsync</c>.
    /// </summary>
    public const string AuthInvalidRecoveryPhrase = "auth.invalid_recovery_phrase";
}
