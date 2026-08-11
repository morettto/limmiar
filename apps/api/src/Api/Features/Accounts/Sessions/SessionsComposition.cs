namespace Api.Accounts;

public static class SessionsComposition
{
    public static void AddSessions(this IServiceCollection services)
    {
        services.AddSingleton<ISessionTokenIssuer, SessionTokenIssuer>();
    }
}
