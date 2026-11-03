using Api.Serialization;
using Npgsql;

namespace Api.Accounts;

public static class AccountsComposition
{
    public static void AddAccounts(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IAccountStore, PostgresAccountStore>();

        services.AddSessions();
        // WebAuthn's fail-fast config guards must run before ProfessionalVerification's
        // StaffAccess:ApiKey guard, which must run before TwoFactor's Totp:EncryptionKey guard
        // -- MissingConfigurationTests pins this exact order (AbacatePay:WebhookSecret, checked
        // in Program.Composition.cs's AddBilling, stays last of all).
        services.AddWebAuthn(configuration);
        services.AddMagicLink();
        services.AddCredentials();
        services.AddProfessionalVerification(configuration);
        services.AddVoiceEnrollment();
        services.AddTwoFactor(configuration);
        services.AddSingleton(sp => new AccountKeyPairService(sp.GetRequiredService<NpgsqlDataSource>()));
        services.AddSingleton<ClinicalVaultStore>();

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, AccountsJsonContext.Default);
        });
    }

    public static void MapAccounts(this IEndpointRouteBuilder app)
    {
        app.MapCredentials();
        app.MapTwoFactor();
        app.MapMagicLink();
        app.MapProfessionalVerification();
        app.MapRecovery();
        app.MapVoiceEnrollment();
        app.MapAccountKeyPairEndpoints();
        app.MapClinicalVault();
    }
}
