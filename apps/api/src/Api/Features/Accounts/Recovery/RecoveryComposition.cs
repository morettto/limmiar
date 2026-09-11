namespace Api.Accounts;

public static class RecoveryComposition
{
    public static void MapRecovery(this IEndpointRouteBuilder app)
    {
        app.MapRecoveryEndpoints();
    }
}
