using Npgsql;

namespace Api.Accounts;

public static class MagicLinkComposition
{
    public static void AddMagicLink(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IMagicLinkIssuer, MagicLinkIssuer>();
        services.AddSingleton<IAnonymousPatientAccessStore>(sp => new PostgresAnonymousPatientAccessStore(sp.GetRequiredService<NpgsqlDataSource>()));
    }

    public static void MapMagicLink(this IEndpointRouteBuilder app) => app.MapMagicLinkEndpoints();
}
