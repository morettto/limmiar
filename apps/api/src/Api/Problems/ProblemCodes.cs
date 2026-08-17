namespace Api.Problems;

public static class ProblemCodes
{
    public const string HealthDatabaseUnreachable = "health.database_unreachable";

    public const string UnexpectedError = "unexpected_error";

    public const string ValidationInvalidField = "validation.invalid_field";

    public const string AuthEmailAlreadyRegistered = "auth.email_already_registered";

    // Same code for unknown e-mail and wrong password, so a caller can't tell them apart.
    public const string AuthInvalidCredentials = "auth.invalid_credentials";

    public const string AuthGoogleTokenInvalid = "auth.google_token_invalid";

    public const string AuthAccountNotFound = "auth.account_not_found";

    public const string AuthNotAProfessionalAccount = "auth.not_a_professional_account";

    public const string AuthInvalidVerificationState = "auth.invalid_verification_state";

    public const string AuthNotInReview = "auth.not_in_review";

    public const string AuthTotpAlreadyEnabled = "auth.totp_already_enabled";

    public const string AuthTotpNotPending = "auth.totp_not_pending";

    public const string AuthTotpInvalidCode = "auth.totp_invalid_code";

    public const string AuthTotpNotEnabled = "auth.totp_not_enabled";

    public const string AuthTotpTicketInvalid = "auth.totp_ticket_invalid";

    public const string StaffUnauthorized = "staff.unauthorized";

    // Same code for never-issued, expired, and reuse-detected, so a caller can't tell them apart.
    public const string AuthRefreshTokenInvalid = "auth.refresh_token_invalid";

    public const string AuthAccessTokenInvalid = "auth.access_token_invalid";

    // Same code for expired/claimed/wrong-account, so a stolen QR code can't be told apart from a live one.
    public const string DevicePairingSessionNotFound = "auth.device_pairing_session_not_found";

    public const string DevicePairingPayloadNotReady = "auth.device_pairing_payload_not_ready";

    public const string DevicePairingPayloadNotDelivered = "auth.device_pairing_payload_not_delivered";

    // Same code for never-issued, expired, and already-used, so a caller can't probe which one applies.
    public const string AuthMagicLinkInvalid = "auth.magic_link_invalid";

    // Collapses every WebAuthn ceremony failure reason into one code -- distinguishing them would give an oracle against a live biometric ceremony.
    public const string AuthWebAuthnCeremonyFailed = "auth.webauthn_ceremony_failed";

    public const string AuthInvalidRecoveryPhrase = "auth.invalid_recovery_phrase";

    public const string PatientsNotFound = "patients.not_found";

    public const string PatientsNotAuthorizedToCreateRecords = "patients.not_authorized_to_create_records";

    public const string PatientsEntrySequenceConflict = "patients.entry_sequence_conflict";

    public const string AgendaNotAuthorizedToSchedule = "agenda.not_authorized_to_schedule";

    public const string AgendaSlotTaken = "agenda.slot_taken";

    public const string AgendaSessionNotFound = "agenda.session_not_found";

    public const string AgendaSessionCancelled = "agenda.session_cancelled";

    public const string AgendaRecordingActive = "agenda.recording_active";
}
