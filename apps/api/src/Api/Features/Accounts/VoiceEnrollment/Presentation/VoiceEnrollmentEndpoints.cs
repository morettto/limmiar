using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using static Api.Accounts.AccountsProblemResults;
using static Api.Accounts.SessionTokenIssuerAuthorization;
using static Api.Problems.ProblemResults;
using static Api.Problems.SealedBlobShape;

namespace Api.Accounts;

public static class VoiceEnrollmentEndpoints
{
    public static void MapVoiceEnrollmentEndpoints(this WebApplication app)
    {
        app.MapPut("/accounts/{accountId:guid}/voice-enrollment", HandlePutAsync)
            .WithName("PutVoiceEnrollment")
            .WithSummary("Register (or replace) the account's voice cadastro")
            .WithDescription("Idempotent: re-enrollment overwrites the previous wrapped DEK and sealed embedding, 204, never 409 -- there is exactly one voice cadastro per account, not a history. Requires an Authorization: Bearer access token for this exact account -- gated by account ownership only (EndpointHelpers.IsAuthorizedForAccount), not AccountAuthorizationGuard.CanCreatePatientRecords, since this is the professional's own account, not a patient record.")
            .Produces(StatusCodes.Status204NoContent)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");

        app.MapGet("/accounts/{accountId:guid}/voice-enrollment", HandleGetAsync)
            .WithName("GetVoiceEnrollment")
            .WithSummary("Read the account's voice cadastro")
            .WithDescription("404 with auth.account_not_found if the account does not exist, 404 with voice.enrollment_not_found if the account exists but has no voice cadastro registered yet. Requires an Authorization: Bearer access token for this exact account.")
            .Produces<VoiceEnrollmentResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");

        app.MapDelete("/accounts/{accountId:guid}/voice-enrollment", HandleDeleteAsync)
            .WithName("DeleteVoiceEnrollment")
            .WithSummary("Remove the account's voice cadastro")
            .WithDescription("404 if there is no cadastro to remove -- deleting a non-existent cadastro is not a silent no-op 204. Requires an Authorization: Bearer access token for this exact account.")
            .Produces(StatusCodes.Status204NoContent)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");
    }

    private static async Task<Results<NoContent, JsonHttpResult<LimmiarProblemDetails>>> HandlePutAsync(
        Guid accountId,
        VoiceEnrollmentRequest request,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        VoiceEnrollmentService voiceEnrollmentService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        if (!TryValidateSealedBlobShape(request.WrappedDek, "wrappedDek", out var wrappedDekProblem))
        {
            return wrappedDekProblem;
        }

        if (!TryValidateSealedBlobShape(request.SealedEmbedding, "sealedEmbedding", out var sealedEmbeddingProblem))
        {
            return sealedEmbeddingProblem;
        }

        var failure = await voiceEnrollmentService.EnrollAsync(accountId, request.WrappedDek, request.SealedEmbedding, cancellationToken);
        if (failure is not null)
        {
            return MapFailureToProblem(failure.Value);
        }

        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<VoiceEnrollmentResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleGetAsync(
        Guid accountId,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        VoiceEnrollmentService voiceEnrollmentService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        var result = await voiceEnrollmentService.GetAsync(accountId, cancellationToken);
        return result.Match<Results<Ok<VoiceEnrollmentResponse>, JsonHttpResult<LimmiarProblemDetails>>>(
            enrollment => TypedResults.Ok(new VoiceEnrollmentResponse(enrollment.WrappedDek, enrollment.SealedEmbedding)),
            reason => MapFailureToProblem(reason));
    }

    private static async Task<Results<NoContent, JsonHttpResult<LimmiarProblemDetails>>> HandleDeleteAsync(
        Guid accountId,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        VoiceEnrollmentService voiceEnrollmentService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        var failure = await voiceEnrollmentService.DeleteAsync(accountId, cancellationToken);
        if (failure is not null)
        {
            return MapFailureToProblem(failure.Value);
        }

        return TypedResults.NoContent();
    }

    // [ExcludeFromCodeCoverage] justification: both named VoiceEnrollmentFailureReason arms are
    // exercised by dedicated tests for both verbs that share this mapper --
    //   AccountNotFound -> DeleteVoiceEnrollment_WithUnknownAccountId_Returns404WithProblemDetails
    //                      GetVoiceEnrollment_WithUnknownAccountId_Returns404WithProblemDetails
    //   NotEnrolled     -> DeleteVoiceEnrollment_WithoutPriorEnrollment_Returns404WithProblemDetails
    //                      GetVoiceEnrollment_WithoutPriorEnrollment_Returns404WithProblemDetails
    // Same reasoning as PatientEndpoints.MapCreateFailureToProblem: a switch expression over a
    // 2+-value enum compiles to a jump table with a compiler-generated unreachable "no match"
    // fallback that coverlet still counts as a missed branch.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(Justification =
        "Every named case is covered by a dedicated test (see comment above); the remaining " +
        "gap is the compiler-generated unreachable fallback for the switch expression.")]
    private static JsonHttpResult<LimmiarProblemDetails> MapFailureToProblem(VoiceEnrollmentFailureReason reason) =>
        reason switch
        {
            VoiceEnrollmentFailureReason.AccountNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Account not found", AccountsProblemCodes.AuthAccountNotFound),
            VoiceEnrollmentFailureReason.NotEnrolled =>
                ProblemJson(StatusCodes.Status404NotFound, "Voice enrollment not found", AccountsProblemCodes.VoiceEnrollmentNotFound),
            _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
        };
}

public sealed record VoiceEnrollmentRequest(byte[] WrappedDek, byte[] SealedEmbedding);

public sealed record VoiceEnrollmentResponse(byte[] WrappedDek, byte[] SealedEmbedding);
