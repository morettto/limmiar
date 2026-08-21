using System.Text.Json;
using Api.Problems;
using Api.Serialization;
using Microsoft.AspNetCore.Diagnostics;

namespace Api.ExceptionHandling;

/// <summary>
/// Global fallback for any exception not otherwise handled by an endpoint's own logic. Ensures
/// the acceptance criterion "every API error response is ProblemDetails with code + params,
/// never a ready-made message" also holds for exceptions no one anticipated -- without this,
/// an unhandled exception anywhere in the API would fall through to ASP.NET Core's default,
/// non-conforming error response instead.
/// </summary>
/// <remarks>
/// Deliberately never writes <see cref="Exception.Message"/> or the stack trace into the
/// response body -- that would leak a raw server string, the exact thing
/// <see cref="LimmiarProblemDetails"/>'s code-not-message design exists to prevent.
/// </remarks>
public sealed class GlobalProblemExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var problem = new LimmiarProblemDetails
        {
            Status = StatusCodes.Status500InternalServerError,
            Title = "An unexpected error occurred",
            Code = ProblemCodes.UnexpectedError,
        };

        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
        httpContext.Response.ContentType = "application/problem+json";

        await JsonSerializer.SerializeAsync(
            httpContext.Response.Body,
            problem,
            ApiJsonSerializerContext.Default.LimmiarProblemDetails,
            cancellationToken);

        return true;
    }
}
