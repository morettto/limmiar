namespace Api.Accounts;

/// <summary>
/// Authorization guard for actions that require a fully verified professional account.
///
/// S02-02 acceptance criterion: "Conta pendente de validação não consegue criar
/// paciente." The patient-creation endpoint itself belongs to Spec S03 (ticket S03-01),
/// which hasn't started yet -- there is nothing to wire this into today. This guard exists
/// so that endpoint (and any other professional-only, credential-gated action) has a
/// single, already-tested authorization check to call from day one, instead of
/// reimplementing the role/status check inline. TODO(S03-01): call
/// <see cref="CanCreatePatientRecords"/> before allowing patient creation.
/// </summary>
public static class AccountAuthorizationGuard
{
    /// <summary>
    /// True only for a <see cref="AccountRole.Professional"/> account whose
    /// <see cref="Account.VerificationStatus"/> is <see cref="AccountVerificationStatus.Active"/>.
    /// A <see cref="AccountRole.Patient"/> account is never authorized here -- patient
    /// creation is a professional-only action.
    /// </summary>
    public static bool CanCreatePatientRecords(Account account) =>
        account.Role == AccountRole.Professional && account.VerificationStatus == AccountVerificationStatus.Active;
}
