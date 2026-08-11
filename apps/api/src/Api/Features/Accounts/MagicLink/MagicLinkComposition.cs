namespace Api.Accounts;

public static class MagicLinkComposition
{
    public static void AddMagicLink(this IServiceCollection services, IConfiguration configuration)
    {
        // MagicLink:TokenLifetimeSeconds (E2E only): shortens the token TTL so a "token expired" test doesn't wait out the real window.
        var overrideSeconds = configuration.GetValue<double?>("MagicLink:TokenLifetimeSeconds");
        services.AddSingleton<IMagicLinkIssuer>(_ => overrideSeconds is { } seconds
            ? new MagicLinkIssuer(tokenLifetime: TimeSpan.FromSeconds(seconds))
            : new MagicLinkIssuer());

        // MagicLink:TestCaptureEndpoint (E2E only): swaps in CapturingMagicLinkEmailSender + the debug route, since there's no real e-mail infra for Playwright to read a "sent" link from.
        if (configuration.GetValue<bool>("MagicLink:TestCaptureEndpoint"))
        {
            services.AddSingleton<CapturingMagicLinkEmailSender>();
            services.AddSingleton<IMagicLinkEmailSender>(sp => sp.GetRequiredService<CapturingMagicLinkEmailSender>());
        }
        else
        {
            services.AddSingleton<IMagicLinkEmailSender, MagicLinkEmailSender>();
        }
    }

    public static void MapMagicLink(this WebApplication app)
    {
        app.MapMagicLinkEndpoints();

        if (app.Configuration.GetValue<bool>("MagicLink:TestCaptureEndpoint"))
        {
            app.MapMagicLinkDebugEndpoints();
        }
    }
}
