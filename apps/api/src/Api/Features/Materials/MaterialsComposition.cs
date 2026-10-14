using System.Text.Json.Serialization;

namespace Api.Materials;

public static class MaterialsComposition
{
    public static void AddMaterials(this IServiceCollection services)
    {
        services.AddSingleton<MaterialStore>();
        services.ConfigureHttpJsonOptions(options => options.SerializerOptions.TypeInfoResolverChain.Insert(0, MaterialsJsonContext.Default));
    }

    public static void MapMaterials(this IEndpointRouteBuilder app) => app.MapMaterialEndpoints();
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(CreateMaterialRequest))]
[JsonSerializable(typeof(MaterialAuthorizationRequest))]
[JsonSerializable(typeof(MaterialSummary))]
[JsonSerializable(typeof(MaterialContent))]
[JsonSerializable(typeof(MaterialList))]
public partial class MaterialsJsonContext : JsonSerializerContext;
