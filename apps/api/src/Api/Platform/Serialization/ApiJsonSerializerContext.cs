using System.Text.Json.Serialization;
using Api.Problems;

namespace Api.Serialization;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(LimmiarProblemDetails))]
[JsonSerializable(typeof(Dictionary<string, string>))]
public partial class ApiJsonSerializerContext : JsonSerializerContext
{
}
