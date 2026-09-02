using System.Text.Json;
using System.Text.Json.Serialization;
using Api.Accounts;

namespace Api.Consent;

public static class ConsentComposition
{
    public static void AddConsent(this IServiceCollection services)
    {
        services.AddSingleton<ConsentEventStore>();
        services.AddSingleton(sp => new ConsentService(
            sp.GetRequiredService<IAccountStore>(),
            sp.GetRequiredService<ConsentEventStore>()));

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, ConsentJsonContext.Default);
            // ConsentStatus só sai na resposta do GET. O overload genérico fechado é o AOT-safe,
            // e registá-lo aqui (não por atributo em ConsentEvent.cs) mantém a decisão neste
            // ficheiro; o pedido continua a parsear à mão, ver TryParseDefinedEnum.
            options.SerializerOptions.Converters.Add(new JsonStringEnumConverter<ConsentStatus>(JsonNamingPolicy.CamelCase));
        });
    }

    public static void MapConsent(this WebApplication app)
    {
        app.MapConsentEndpoints();
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(RecordConsentRequest))]
[JsonSerializable(typeof(RecordConsentResponse))]
[JsonSerializable(typeof(ConsentSnapshot))]
public partial class ConsentJsonContext : JsonSerializerContext
{
}
