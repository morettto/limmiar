namespace Api.Accounts;

public static class CredentialsComposition
{
    public static void AddCredentials(this IServiceCollection services)
    {
        services.AddSingleton<IPasswordVerifierComparer, ConstantTimePasswordVerifierComparer>();
        services.AddSingleton<IGoogleIdentityProvider, GoogleIdentityProvider>();
    }

    public static void MapCredentials(this IEndpointRouteBuilder app)
    {
        app.MapAuthEndpoints();
    }
}
