namespace Api.Accounts;

public interface IStaffAccessGuard
{
    bool IsAuthorized(string? providedApiKey);
}
