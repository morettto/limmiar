using Api.Accounts;
using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using static Api.Accounts.AccountsProblemResults;
using static Api.Accounts.SessionTokenIssuerAuthorization;
using static Api.Problems.ProblemResults;

namespace Api.Scheduling;

public static class SchedulingEndpoints
{
    private const int MinDurationMinutes = 1;
    private const int MaxDurationMinutes = 1440;

    public static void MapSchedulingEndpoints(this WebApplication app)
    {
        app.MapPost("/accounts/{accountId:guid}/agenda/sessions", HandleScheduleAsync)
            .WithName("PostScheduledSession")
            .WithSummary("Schedule a session")
            .WithDescription("Two concurrent requests for the same (account, startsAt) slot: exactly one persists, the other gets 409 agenda.slot_taken -- the DB's scheduled_sessions_live_slot_uq partial unique index is what actually decides the race. Requires an Authorization: Bearer access token for this exact account, and the account must be an active Professional.")
            .Produces<ScheduledSessionResponse>(StatusCodes.Status201Created)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapPatch("/accounts/{accountId:guid}/agenda/sessions/{sessionId:guid}", HandleMoveAsync)
            .WithName("PatchScheduledSession")
            .WithSummary("Move a session to a new slot")
            .WithDescription("Rejected with 409 agenda.recording_active if the session's recording is active, and 409 agenda.session_cancelled if it was already cancelled. Requires an Authorization: Bearer access token for this exact account.")
            .Produces<ScheduledSessionResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapDelete("/accounts/{accountId:guid}/agenda/sessions/{sessionId:guid}", HandleCancelAsync)
            .WithName("DeleteScheduledSession")
            .WithSummary("Cancel a session (soft delete)")
            .WithDescription("Writes cancelled_at; the row is never removed. Rejected with 409 agenda.recording_active if the session's recording is active. Requires an Authorization: Bearer access token for this exact account.")
            .Produces(StatusCodes.Status204NoContent)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");
    }

    private static async Task<Results<Created<ScheduledSessionResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleScheduleAsync(
        Guid accountId,
        ScheduleSessionRequest request,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        SchedulingService schedulingService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        if (!IsValidDuration(request.DurationMinutes, out var durationProblem))
        {
            return durationProblem;
        }

        var result = await schedulingService.ScheduleAsync(
            accountId, request.PatientId, request.StartsAt, request.DurationMinutes, cancellationToken);
        if (!result.TryGetValue(out var session, out var failureReason))
        {
            return MapFailureToProblem(failureReason);
        }

        return TypedResults.Created(
            $"/accounts/{accountId}/agenda/sessions/{session.Id}",
            ToResponse(session));
    }

    private static async Task<Results<Ok<ScheduledSessionResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleMoveAsync(
        Guid accountId,
        Guid sessionId,
        MoveSessionRequest request,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        SchedulingService schedulingService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        if (!IsValidDuration(request.DurationMinutes, out var durationProblem))
        {
            return durationProblem;
        }

        var result = await schedulingService.MoveAsync(
            accountId, sessionId, request.StartsAt, request.DurationMinutes, cancellationToken);
        if (!result.TryGetValue(out var session, out var failureReason))
        {
            return MapFailureToProblem(failureReason);
        }

        return TypedResults.Ok(ToResponse(session));
    }

    private static async Task<Results<NoContent, JsonHttpResult<LimmiarProblemDetails>>> HandleCancelAsync(
        Guid accountId,
        Guid sessionId,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        SchedulingService schedulingService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        var result = await schedulingService.CancelAsync(accountId, sessionId, cancellationToken);
        if (!result.TryGetValue(out _, out var failureReason))
        {
            return MapFailureToProblem(failureReason);
        }

        return TypedResults.NoContent();
    }

    private static bool IsValidDuration(int durationMinutes, out JsonHttpResult<LimmiarProblemDetails> problem)
    {
        if (durationMinutes < MinDurationMinutes || durationMinutes > MaxDurationMinutes)
        {
            problem = ValidationProblem("durationMinutes");
            return false;
        }

        problem = default!;
        return true;
    }

    private static ScheduledSessionResponse ToResponse(ScheduledSession session) =>
        new(session.Id, session.PatientId, session.StartsAt, session.DurationMinutes, session.CancelledAt);

    // [ExcludeFromCodeCoverage] justification: every named SchedulingFailureReason arm reachable
    // from Schedule, Move or Cancel is exercised by a dedicated test in
    // SchedulingEndpointsTests -- SlotTaken is only reachable from Schedule and Move (Cancel
    // never changes starts_at, see SchedulingFailureReason's docs); the remaining gap is the
    // compiler-generated unreachable fallback for a 6-value switch expression.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(Justification =
        "Every named case reachable from Schedule, Move or Cancel is covered by a dedicated " +
        "test; the remaining gap is the compiler-generated unreachable fallback for a 6-value " +
        "switch expression.")]
    private static JsonHttpResult<LimmiarProblemDetails> MapFailureToProblem(SchedulingFailureReason reason) =>
        reason switch
        {
            SchedulingFailureReason.AccountNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Account not found", AccountsProblemCodes.AuthAccountNotFound),
            SchedulingFailureReason.NotAuthorizedToSchedule =>
                ProblemJson(StatusCodes.Status403Forbidden, "Account is not authorized to schedule sessions", SchedulingProblemCodes.AgendaNotAuthorizedToSchedule),
            SchedulingFailureReason.SessionNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Session not found", SchedulingProblemCodes.AgendaSessionNotFound),
            SchedulingFailureReason.SessionCancelled =>
                ProblemJson(StatusCodes.Status409Conflict, "Session already cancelled", SchedulingProblemCodes.AgendaSessionCancelled),
            SchedulingFailureReason.RecordingActive =>
                ProblemJson(StatusCodes.Status409Conflict, "Session has an active recording", SchedulingProblemCodes.AgendaRecordingActive),
            SchedulingFailureReason.SlotTaken =>
                ProblemJson(StatusCodes.Status409Conflict, "Slot already taken", SchedulingProblemCodes.AgendaSlotTaken),
            _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
        };
}

public sealed record ScheduleSessionRequest(Guid PatientId, DateTimeOffset StartsAt, int DurationMinutes);

public sealed record MoveSessionRequest(DateTimeOffset StartsAt, int DurationMinutes);

public sealed record ScheduledSessionResponse(Guid SessionId, Guid PatientId, DateTimeOffset StartsAt, int DurationMinutes, DateTimeOffset? CancelledAt);
