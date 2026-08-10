using Api.Problems;
using Api.Serialization;
using Microsoft.AspNetCore.Http.HttpResults;
using Npgsql;

namespace Api.Endpoints;

public static class HealthEndpoints
{
    private static readonly TimeSpan DatabaseProbeTimeout = TimeSpan.FromSeconds(2);

    public static void MapHealthEndpoints(this WebApplication app)
    {
        app.MapGet("/health", () => TypedResults.Ok())
            .WithName("GetHealth")
            .WithSummary("Liveness probe")
            .WithDescription("Always returns 200 OK when the process is running. Has no external dependencies.")
            .Produces(StatusCodes.Status200OK);

        app.MapGet("/health/db", HandleGetHealthDbAsync)
            .WithName("GetHealthDb")
            .WithSummary("Database readiness probe")
            .WithDescription("Opens a connection to Postgres and runs SELECT 1. Returns 503 with a problem details body when the database is unreachable.")
            .Produces(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json");
    }

    private static async Task<Results<Ok, JsonHttpResult<LimmiarProblemDetails>>> HandleGetHealthDbAsync(
        NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        Results<Ok, JsonHttpResult<LimmiarProblemDetails>> result;

        try
        {
            using var timeoutCts = new CancellationTokenSource(DatabaseProbeTimeout);
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

            await using var connection = await dataSource.OpenConnectionAsync(linkedCts.Token);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT 1";
            await command.ExecuteScalarAsync(linkedCts.Token);

            result = TypedResults.Ok();
        }
        catch (Exception ex) when (ex is NpgsqlException or TimeoutException or OperationCanceledException)
        {
            var problem = new LimmiarProblemDetails
            {
                Status = StatusCodes.Status503ServiceUnavailable,
                Title = "Database unreachable",
                Code = ProblemCodes.HealthDatabaseUnreachable,
            };

            result = TypedResults.Json(
                problem,
                ApiJsonSerializerContext.Default.LimmiarProblemDetails,
                contentType: "application/problem+json",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return result;
    }
}
