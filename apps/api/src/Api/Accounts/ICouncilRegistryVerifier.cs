namespace Api.Accounts;

public sealed class CouncilRegistryVerificationResult
{
    public required bool Verified { get; init; }

    public string? FailureReason { get; init; }

    public static CouncilRegistryVerificationResult CreateVerified() => new() { Verified = true };

    public static CouncilRegistryVerificationResult NotVerified(string failureReason) =>
        new() { Verified = false, FailureReason = failureReason };
}

public interface ICouncilRegistryVerifier
{
    Task<CouncilRegistryVerificationResult> VerifyAsync(
        ProfessionalCredentialType type, string registryNumber, string registryUf, CancellationToken cancellationToken);
}
