namespace Api.Accounts;

public sealed record Account(
    Guid Id,
    string Email,
    AccountRole Role,
    byte[]? PasswordVerifier,
    string? GoogleSubjectId,
    AccountVerificationStatus VerificationStatus = AccountVerificationStatus.Active,
    string? RejectionReason = null,
    DateTimeOffset? VerificationSubmittedAt = null,
    string? TotpSecret = null,
    DateTimeOffset? TotpEnabledAt = null,
    IReadOnlyList<string>? TotpBackupCodeHashes = null,
    byte[]? WebAuthnCredentialId = null,
    byte[]? WebAuthnCosePublicKey = null,
    uint? WebAuthnSignCount = null,
    Guid? WebAuthnAaGuid = null,
    byte[]? RecoveryVerifier = null,
    VoiceEnrollment? VoiceEnrollment = null);
