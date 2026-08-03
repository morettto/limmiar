using System.Text.Json;
using Api.Problems;
using Api.Serialization;

namespace Api.Tests.Problems;

public sealed class LimmiarProblemDetailsTests
{
    [Fact]
    public void Serialize_IncludesCodeAndParams()
    {
        var problem = new LimmiarProblemDetails
        {
            Status = 503,
            Title = "Service unavailable",
            Code = "health.database_unreachable",
            Params = new Dictionary<string, string>
            {
                ["reason"] = "timeout",
            },
        };

        var json = JsonSerializer.Serialize(problem, ApiJsonSerializerContext.Default.LimmiarProblemDetails);

        using var doc = JsonDocument.Parse(json);
        Assert.Equal(503, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("health.database_unreachable", doc.RootElement.GetProperty("code").GetString());
        Assert.Equal("timeout", doc.RootElement.GetProperty("params").GetProperty("reason").GetString());
    }

    [Fact]
    public void Serialize_WithNoParams_ProducesEmptyParamsObject()
    {
        var problem = new LimmiarProblemDetails
        {
            Status = 400,
            Code = "validation.invalid_field",
        };

        var json = JsonSerializer.Serialize(problem, ApiJsonSerializerContext.Default.LimmiarProblemDetails);

        using var doc = JsonDocument.Parse(json);
        var paramsElement = doc.RootElement.GetProperty("params");
        Assert.Equal(JsonValueKind.Object, paramsElement.ValueKind);
        Assert.Empty(paramsElement.EnumerateObject());
    }
}
