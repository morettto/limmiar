namespace Api.Accounts;

public enum BeginTotpEnrollmentFailureReason
{
    AccountNotFound,
    NotAProfessionalAccount,

    /// <summary>The account already confirmed a TOTP enrollment -- reconfiguring an already-enabled account is out of this ticket's scope.</summary>
    AlreadyEnabled,
}

public sealed class BeginTotpEnrollmentResult
{
    public required bool Succeeded { get; init; }

    /// <summary>The freshly generated Base32 secret, pending confirmation. Meaningless when <see cref="Succeeded"/> is false.</summary>
    public string? Secret { get; init; }

    /// <summary>An otpauth:// URI an authenticator app can import. Meaningless when <see cref="Succeeded"/> is false.</summary>
    public string? ProvisioningUri { get; init; }

    public BeginTotpEnrollmentFailureReason? FailureReason { get; init; }

    public static BeginTotpEnrollmentResult Success(string secret, string provisioningUri) =>
        new() { Succeeded = true, Secret = secret, ProvisioningUri = provisioningUri };

    public static BeginTotpEnrollmentResult Failure(BeginTotpEnrollmentFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
