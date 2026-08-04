using System.Text.Json.Serialization;
using Api.Accounts;
using Api.Problems;

namespace Api.Serialization;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(LimmiarProblemDetails))]
[JsonSerializable(typeof(Dictionary<string, string>))]
[JsonSerializable(typeof(RegisterRequest))]
[JsonSerializable(typeof(RegisterResponse))]
[JsonSerializable(typeof(LoginRequest))]
[JsonSerializable(typeof(LoginResponse))]
[JsonSerializable(typeof(GoogleAuthRequest))]
[JsonSerializable(typeof(GoogleAuthResponse))]
public partial class ApiJsonSerializerContext : JsonSerializerContext
{
}
