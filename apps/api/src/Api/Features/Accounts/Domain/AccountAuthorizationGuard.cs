namespace Api.Accounts;

public static class AccountAuthorizationGuard
{
    public static bool CanCreatePatientRecords(Account account) =>
        account.Role == AccountRole.Professional && account.VerificationStatus == AccountVerificationStatus.Active;
}
