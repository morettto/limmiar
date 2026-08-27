namespace Api.Accounts;

public static class ProfessionalVerificationComposition
{
    public static void AddProfessionalVerification(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<ICouncilRegistryVerifier, CouncilRegistryVerifier>();

        // IsNullOrEmpty (not just null-check): an accidentally empty StaffAccess:ApiKey must fail fast, same as a missing one -- StaffAccessGuard only rejects a null submitted key.
        var staffApiKey = configuration["StaffAccess:ApiKey"];
        if (string.IsNullOrEmpty(staffApiKey))
        {
            throw new InvalidOperationException("Missing required configuration: StaffAccess:ApiKey");
        }

        services.AddSingleton<IStaffAccessGuard>(new StaffAccessGuard(staffApiKey));
    }

    public static void MapProfessionalVerification(this WebApplication app)
    {
        app.MapProfessionalVerificationEndpoints();
    }
}
