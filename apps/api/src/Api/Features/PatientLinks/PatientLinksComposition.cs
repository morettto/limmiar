using System.Text.Json.Serialization;
using Api.Accounts;

namespace Api.PatientLinks;

public static class PatientLinksComposition
{
    public static void AddPatientLinks(this IServiceCollection services)
    {
        services.AddSingleton<PatientLinkStore>();
        services.AddSingleton(sp => new PatientLinkService(
            sp.GetRequiredService<IAccountStore>(),
            sp.GetRequiredService<PatientLinkStore>()));

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, PatientLinksJsonContext.Default);
        });
    }

    public static void MapPatientLinks(this IEndpointRouteBuilder app)
    {
        app.MapPatientLinkEndpoints();
        app.MapSharedItemEndpoints();
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(CreateLinkInviteResponse))]
[JsonSerializable(typeof(RedeemLinkRequest))]
[JsonSerializable(typeof(LinkView))]
[JsonSerializable(typeof(IReadOnlyList<LinkView>))]
[JsonSerializable(typeof(ShareItemRequest))]
[JsonSerializable(typeof(SharedItemView))]
[JsonSerializable(typeof(IReadOnlyList<SharedItemView>))]
[JsonSerializable(typeof(PutSharingPreferencesRequest))]
[JsonSerializable(typeof(SharingPreferencesView))]
[JsonSerializable(typeof(SharingPreferencesVersionView))]
public partial class PatientLinksJsonContext : JsonSerializerContext
{
}
