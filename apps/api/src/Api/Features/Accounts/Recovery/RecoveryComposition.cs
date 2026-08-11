namespace Api.Accounts;

public static class RecoveryComposition
{
    public static void MapRecovery(this WebApplication app)
    {
        app.MapRecoveryEndpoints();
    }
}
