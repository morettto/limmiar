namespace Api.Accounts;

public static class DevicePairingComposition
{
    public static void AddDevicePairing(this IServiceCollection services, IConfiguration configuration)
    {
        // DevicePairing:SessionLifetimeSeconds (E2E only): shortens the pairing-session TTL so the "expired QR" test doesn't wait out the real two-minute window.
        var overrideSeconds = configuration.GetValue<double?>("DevicePairing:SessionLifetimeSeconds");
        services.AddSingleton<IDevicePairingIssuer>(_ => overrideSeconds is { } seconds
            ? new DevicePairingIssuer(sessionLifetime: TimeSpan.FromSeconds(seconds))
            : new DevicePairingIssuer());

        services.AddSingleton<INewDeviceAlertSender, NewDeviceAlertSender>();
        services.AddSingleton<NewDeviceAlertNotifier>();
    }

    public static void MapDevicePairing(this WebApplication app)
    {
        app.MapDevicePairingEndpoints();
    }
}
