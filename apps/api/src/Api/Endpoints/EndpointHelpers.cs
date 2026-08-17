using Api.Accounts;
using Api.Problems;
using Api.Serialization;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Api.Endpoints;

/// <summary>
/// Shared by every endpoint file that needs the "bearer token names this account" check and/or
/// the RFC 7807 JSON problem shape -- <c>AuthEndpoints</c>, <c>DevicePairingEndpoints</c>,
/// <c>ProfessionalVerificationEndpoints</c>, <c>RecoveryEndpoints</c>, <c>TwoFactorEndpoints</c>,
/// <c>PatientEndpoints</c> and <c>SchedulingEndpoints</c> all call into this one copy instead of
/// keeping their own.
/// </summary>
internal static class EndpointHelpers
{
    private const string BearerPrefix = "Bearer ";

    internal static bool IsAuthorizedForAccount(string? authorizationHeader, Guid accountId, ISessionTokenIssuer sessionTokenIssuer)
    {
        if (authorizationHeader is null || !authorizationHeader.StartsWith(BearerPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        var accessToken = authorizationHeader[BearerPrefix.Length..];
        return sessionTokenIssuer.ValidateAccess(accessToken) == accountId;
    }

    internal static JsonHttpResult<LimmiarProblemDetails> AccessTokenUnauthorizedProblem() =>
        ProblemJson(StatusCodes.Status401Unauthorized, "Missing or invalid access token", ProblemCodes.AuthAccessTokenInvalid);

    internal static JsonHttpResult<LimmiarProblemDetails> ValidationProblem(string field) =>
        ProblemJson(
            StatusCodes.Status400BadRequest,
            "Invalid request",
            ProblemCodes.ValidationInvalidField,
            new Dictionary<string, string> { ["field"] = field });

    internal static JsonHttpResult<LimmiarProblemDetails> ProblemJson(
        int status, string title, string code, Dictionary<string, string>? paramsDict = null)
    {
        var problem = new LimmiarProblemDetails
        {
            Status = status,
            Title = title,
            Code = code,
            Params = paramsDict ?? new Dictionary<string, string>(),
        };

        return TypedResults.Json(
            problem,
            ApiJsonSerializerContext.Default.LimmiarProblemDetails,
            contentType: "application/problem+json",
            statusCode: status);
    }
}
