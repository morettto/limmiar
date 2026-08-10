namespace Api.Accounts;

public enum BeginTotpEnrollmentFailureReason
{
    AccountNotFound,
    NotAProfessionalAccount,
    AlreadyEnabled,
}

public sealed class BeginTotpEnrollmentResult
{
    public required bool Succeeded { get; init; }

    public string? Secret { get; init; }

    public string? ProvisioningUri { get; init; }

    public BeginTotpEnrollmentFailureReason? FailureReason { get; init; }

    public static BeginTotpEnrollmentResult Success(string secret, string provisioningUri) =>
        new() { Succeeded = true, Secret = secret, ProvisioningUri = provisioningUri };

    public static BeginTotpEnrollmentResult Failure(BeginTotpEnrollmentFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
