using System.Text.Json.Serialization;

namespace Api.Materials;

public static class MaterialsComposition
{
    public static void AddMaterials(this IServiceCollection services)
    {
        services.AddSingleton<MaterialStore>();
        services.AddHttpClient<MaterialReadiness>((provider, http) =>
        {
            var url = provider.GetRequiredService<IConfiguration>()["Copiloto:BaseUrl"];
            if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
                http.BaseAddress = new Uri(uri.ToString().TrimEnd('/') + "/");
            http.Timeout = TimeSpan.FromSeconds(5);
        });
        services.ConfigureHttpJsonOptions(options => options.SerializerOptions.TypeInfoResolverChain.Insert(0, MaterialsJsonContext.Default));
    }

    public static void MapMaterials(this IEndpointRouteBuilder app) => app.MapMaterialEndpoints();
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(CreateMaterialRequest))]
[JsonSerializable(typeof(MaterialAuthorizationRequest))]
[JsonSerializable(typeof(MaterialUsageRequest))]
[JsonSerializable(typeof(MaterialSummary))]
[JsonSerializable(typeof(MaterialContent))]
[JsonSerializable(typeof(MaterialList))]
public partial class MaterialsJsonContext : JsonSerializerContext;
