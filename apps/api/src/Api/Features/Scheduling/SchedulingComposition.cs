using System.Text.Json.Serialization;
using Api.Accounts;

namespace Api.Scheduling;

public static class SchedulingComposition
{
    public static void AddScheduling(this IServiceCollection services)
    {
        services.AddSingleton<ScheduledSessionStore>();
        services.AddSingleton(sp => new SchedulingService(
            sp.GetRequiredService<IAccountStore>(),
            sp.GetRequiredService<ScheduledSessionStore>()));

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, SchedulingJsonContext.Default);
        });
    }

    public static void MapScheduling(this WebApplication app)
    {
        app.MapSchedulingEndpoints();
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(ScheduleSessionRequest))]
[JsonSerializable(typeof(MoveSessionRequest))]
[JsonSerializable(typeof(ScheduledSessionResponse))]
public partial class SchedulingJsonContext : JsonSerializerContext
{
}
