namespace Api.Accounts;

/// <summary>
/// Minimal containment gate for staff/reviewer-only endpoints
/// (<c>Api.Endpoints.ProfessionalVerificationEndpoints</c>'s queue-listing and
/// decision routes). This backend has no staff/admin account concept yet -- Spec S02
/// marks "Convite de equipe e plano Empresarial" as Out of Scope (owned by S14) -- so this
/// is deliberately NOT real RBAC, just a shared-secret API key check to stop the
/// self-approval vulnerability (any professional could otherwise approve their own
/// document review) until S14 exists.
/// </summary>
public interface IStaffAccessGuard
{
    /// <summary>True only if <paramref name="providedApiKey"/> matches the configured staff API key.</summary>
    bool IsAuthorized(string? providedApiKey);
}
