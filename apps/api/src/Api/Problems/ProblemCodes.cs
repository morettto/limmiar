namespace Api.Problems;

/// <summary>Stable, machine-readable error codes returned in <see cref="LimmiarProblemDetails.Code"/>.</summary>
public static class ProblemCodes
{
    public const string HealthDatabaseUnreachable = "health.database_unreachable";

    /// <summary>Fallback code for any exception not otherwise mapped to a specific problem code.</summary>
    public const string UnexpectedError = "unexpected_error";
}
