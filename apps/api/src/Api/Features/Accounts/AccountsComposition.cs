using Api.Serialization;

namespace Api.Accounts;

public static class AccountsComposition
{
    public static void AddAccounts(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IAccountStore, InMemoryAccountStore>();

        services.AddSessions();
        services.AddTwoFactor();
        // WebAuthn's fail-fast config guards must run before ProfessionalVerification's
        // StaffAccess:ApiKey guard -- MissingConfigurationTests pins this exact order.
        services.AddWebAuthn(configuration);
        services.AddMagicLink(configuration);
        services.AddCredentials();
        services.AddDevicePairing(configuration);
        services.AddProfessionalVerification(configuration);
        services.AddVoiceEnrollment();

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, AccountsJsonContext.Default);
        });
    }

    public static void MapAccounts(this WebApplication app)
    {
        app.MapCredentials();
        app.MapTwoFactor();
        app.MapMagicLink();
        app.MapDevicePairing();
        app.MapProfessionalVerification();
        app.MapRecovery();
        app.MapVoiceEnrollment();
    }
}
