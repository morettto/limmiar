namespace Api.Accounts;

/// <summary>Result of checking a CRP/CRM registry number against the issuing council.</summary>
public sealed class CouncilRegistryVerificationResult
{
    public required bool Verified { get; init; }

    /// <summary>Reader-facing rejection reason (acceptance criterion: "motivo legível"). Null when <see cref="Verified"/>.</summary>
    public string? FailureReason { get; init; }

    public static CouncilRegistryVerificationResult CreateVerified() => new() { Verified = true };

    public static CouncilRegistryVerificationResult NotVerified(string failureReason) =>
        new() { Verified = false, FailureReason = failureReason };
}

/// <summary>
/// Verifies a CRP or CRM registry number against the issuing council's registry
/// (ADR-S02-05: "CRP e CRM validados automaticamente contra base pública"). Never called
/// for <see cref="ProfessionalCredentialType.Document"/> -- that path always goes to human
/// review instead (<see cref="AccountService.SubmitProfessionalCredentialAsync"/>).
/// </summary>
public interface ICouncilRegistryVerifier
{
    Task<CouncilRegistryVerificationResult> VerifyAsync(
        ProfessionalCredentialType type, string registryNumber, string registryUf, CancellationToken cancellationToken);
}
