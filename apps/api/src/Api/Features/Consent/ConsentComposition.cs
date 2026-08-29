using System.Text.Json;
using System.Text.Json.Serialization;
using Api.Accounts;

namespace Api.Consent;

public static class ConsentComposition
{
    // ConsentStatus (ConsentSnapshot's two fields, GET response only) wires as
    // "pendente"/"concedido"/"revogado" (the design signature's literal comment). The
    // closed-generic JsonStringEnumConverter<T> is the AOT-safe overload already used on
    // AccountRole/AccountVerificationStatus/etc. in this repository, unlike the
    // reflection-based non-generic converter the design rejects -- registered at the
    // JsonSerializerOptions level (not a [JsonConverter] attribute on the enum itself, in
    // ConsentEvent.cs, fatia 1, not touched by this fatia) so it stays entirely inside
    // fatia 3's own files. ConsentEndpointsTests duplicates this one-line construction for
    // its own response-reading options rather than this becoming internal/public just for
    // test reuse -- same duplication call already made for CreateFactory() across this
    // test suite.
    private static readonly JsonConverter ConsentStatusStringConverter =
        new JsonStringEnumConverter<ConsentStatus>(JsonNamingPolicy.CamelCase);

    public static void AddConsent(this IServiceCollection services)
    {
        services.AddSingleton<ConsentEventStore>();
        services.AddSingleton(sp => new ConsentService(
            sp.GetRequiredService<IAccountStore>(),
            sp.GetRequiredService<ConsentEventStore>()));

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, ConsentJsonContext.Default);
            options.SerializerOptions.Converters.Add(ConsentStatusStringConverter);
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
