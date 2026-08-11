namespace Api.Accounts;

public static class AccountEmail
{
    public static string Normalize(string email) => email.Trim().ToLowerInvariant();
}
