namespace Api.Problems;

/// <summary>
/// RFC 7807 problem details payload extended with a structured, machine-readable error
/// code and a bag of safe, non-sensitive parameters.
/// </summary>
/// <remarks>
/// Deliberately NOT derived from <see cref="Microsoft.AspNetCore.Mvc.ProblemDetails"/>.
/// That base type carries its own <c>ProblemDetailsJsonConverter</c> (applied via a
/// <c>[JsonConverter]</c> attribute on the base class), which System.Text.Json's
/// source generator honors for derived types too. That converter only knows how to
/// serialize the base type's own members plus its <c>Extensions</c> dictionary -- it
/// silently drops any additional properties a derived type declares (here, <c>Code</c>
/// and <c>Params</c> would vanish from the JSON with no error). See
/// dotnet/aspnetcore#43236 and dotnet/aspnetcore#45646. Defining a standalone type with
/// the same RFC 7807 field names avoids the converter entirely and keeps serialization
/// fully source-generated (AOT-safe).
/// </remarks>
public sealed class LimmiarProblemDetails
{
    public string Type { get; init; } = "about:blank";

    public string? Title { get; init; }

    public required int Status { get; init; }

    public string? Detail { get; init; }

    public string? Instance { get; init; }

    /// <summary>Stable, machine-readable error code (e.g. "health.database_unreachable").</summary>
    public required string Code { get; init; }

    /// <summary>Structured, non-sensitive parameters describing the error. Never raw exception messages.</summary>
    public Dictionary<string, string> Params { get; init; } = new();
}
