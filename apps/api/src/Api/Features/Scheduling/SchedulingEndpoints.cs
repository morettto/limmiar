using System.Globalization;
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
    private static readonly TimeSpan MaxListWindow = TimeSpan.FromDays(7);

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

        app.MapGet("/accounts/{accountId:guid}/agenda/sessions", HandleListAsync)
            .WithName("ListScheduledSessions")
            .WithSummary("List sessions inside a window")
            .WithDescription("Half-open [from,to), max 7 days, cancelled sessions excluded. from/to are ISO-8601 instants. Requires an Authorization: Bearer access token for this exact account: no/invalid token -> 401, a valid token for a different account -> 403 (same body whether or not that account exists).")
            .Produces<ListScheduledSessionsResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json");

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
        if (AccountAccessProblem(authorization, accountId, sessionTokenIssuer) is { } accessProblem)
        {
            return accessProblem;
        }

        if (!IsValidDuration(request.DurationMinutes, out var durationProblem))
        {
            return durationProblem;
        }

        var result = await schedulingService.ScheduleAsync(
            accountId, request.PatientId, request.StartsAt, request.DurationMinutes, cancellationToken);
        return result.Match<Results<Created<ScheduledSessionResponse>, JsonHttpResult<LimmiarProblemDetails>>>(
            session => TypedResults.Created(
                $"/accounts/{accountId}/agenda/sessions/{session.Id}",
                ToResponse(session)),
            reason => MapFailureToProblem(reason));
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
        if (AccountAccessProblem(authorization, accountId, sessionTokenIssuer) is { } accessProblem)
        {
            return accessProblem;
        }

        if (!IsValidDuration(request.DurationMinutes, out var durationProblem))
        {
            return durationProblem;
        }

        var result = await schedulingService.MoveAsync(
            accountId, sessionId, request.StartsAt, request.DurationMinutes, cancellationToken);
        return result.Match<Results<Ok<ScheduledSessionResponse>, JsonHttpResult<LimmiarProblemDetails>>>(
            session => TypedResults.Ok(ToResponse(session)),
            reason => MapFailureToProblem(reason));
    }

    private static async Task<Results<NoContent, JsonHttpResult<LimmiarProblemDetails>>> HandleCancelAsync(
        Guid accountId,
        Guid sessionId,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        SchedulingService schedulingService,
        CancellationToken cancellationToken)
    {
        if (AccountAccessProblem(authorization, accountId, sessionTokenIssuer) is { } accessProblem)
        {
            return accessProblem;
        }

        var result = await schedulingService.CancelAsync(accountId, sessionId, cancellationToken);
        return result.Match<Results<NoContent, JsonHttpResult<LimmiarProblemDetails>>>(
            _ => TypedResults.NoContent(),
            reason => MapFailureToProblem(reason));
    }

    private static async Task<Results<Ok<ListScheduledSessionsResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleListAsync(
        Guid accountId,
        string? from,
        string? to,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        ScheduledSessionStore store,
        CancellationToken cancellationToken)
    {
        if (AccountAccessProblem(authorization, accountId, sessionTokenIssuer) is { } accessProblem)
        {
            return accessProblem;
        }

        if (!TryParseWindow(from, to, out var fromUtc, out var toUtc, out var windowProblem))
        {
            return windowProblem;
        }

        var sessions = await store.ListLiveAsync(accountId, fromUtc, toUtc, cancellationToken);
        return TypedResults.Ok(new ListScheduledSessionsResponse(sessions.Select(ToResponse).ToList()));
    }

    /// <summary>from missing/unparseable -&gt; ValidationProblem("from"); to missing/unparseable, to&lt;=from, or window &gt; 7d -&gt; ValidationProblem("to").</summary>
    private static bool TryParseWindow(
        string? from,
        string? to,
        out DateTimeOffset fromUtc,
        out DateTimeOffset toUtc,
        out JsonHttpResult<LimmiarProblemDetails> problem)
    {
        fromUtc = default;
        toUtc = default;
        problem = default!;

        if (from is null || !DateTimeOffset.TryParse(from, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out fromUtc))
        {
            problem = ValidationProblem("from");
            return false;
        }

        fromUtc = fromUtc.ToUniversalTime();

        if (to is null || !DateTimeOffset.TryParse(to, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out toUtc))
        {
            problem = ValidationProblem("to");
            return false;
        }

        toUtc = toUtc.ToUniversalTime();

        if (toUtc <= fromUtc || toUtc - fromUtc > MaxListWindow)
        {
            problem = ValidationProblem("to");
            return false;
        }

        return true;
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

public sealed record ListScheduledSessionsResponse(IReadOnlyList<ScheduledSessionResponse> Sessions);
