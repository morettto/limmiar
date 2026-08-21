namespace Api.Accounts;

public static class TwoFactorComposition
{
    public static void AddTwoFactor(this IServiceCollection services)
    {
        services.AddSingleton<ITotpProvider, TotpProvider>();
        services.AddSingleton<ITwoFactorTicketIssuer, TwoFactorTicketIssuer>();
    }

    public static void MapTwoFactor(this WebApplication app)
    {
        app.MapTwoFactorEndpoints();
    }
}
