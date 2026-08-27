namespace Api.Accounts;

public static class VoiceEnrollmentComposition
{
    public static void AddVoiceEnrollment(this IServiceCollection services)
    {
        services.AddSingleton(sp => new VoiceEnrollmentService(sp.GetRequiredService<IAccountStore>()));
    }

    public static void MapVoiceEnrollment(this WebApplication app)
    {
        app.MapVoiceEnrollmentEndpoints();
    }
}
