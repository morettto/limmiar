using Api.Accounts;
using Api.Platform;

namespace Api.Scheduling;

/// <summary>
/// Shared by <see cref="SchedulingService.ScheduleAsync"/>, <see cref="SchedulingService.MoveAsync"/>
/// and <see cref="SchedulingService.CancelAsync"/> -- one enum, not three near-identical ones,
/// since every member applies identically across every operation that can reach it.
/// <see cref="SlotTaken"/> is only ever produced by Schedule and Move: Cancel never changes
/// <c>starts_at</c>, so it can never collide with another live row. The failure-to-problem
/// mapping in the endpoints layer already switches over every named member, so this narrow
/// asymmetry costs nothing extra to represent.
/// </summary>
public enum SchedulingFailureReason
{
    AccountNotFound,
    NotAuthorizedToSchedule,
    SessionNotFound,
    SessionCancelled,
    RecordingActive,
    SlotTaken,
}

public sealed class SchedulingService(IAccountStore accounts, ScheduledSessionStore store)
{
    public async Task<Result<ScheduledSession, SchedulingFailureReason>> ScheduleAsync(
        Guid professionalId, Guid patientId, DateTimeOffset startsAt, int durationMinutes, CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(professionalId, cancellationToken);
        if (authorizationFailure is not null)
        {
            return Result<ScheduledSession, SchedulingFailureReason>.Failure(authorizationFailure.Value);
        }

        try
        {
            // timestamptz requires a zero-offset (UTC) value from Npgsql.
            var session = await store.InsertAsync(professionalId, patientId, startsAt.ToUniversalTime(), durationMinutes, cancellationToken);
            return Result<ScheduledSession, SchedulingFailureReason>.Success(session);
        }
        catch (ScheduledSessionSlotConflictException)
        {
            return Result<ScheduledSession, SchedulingFailureReason>.Failure(SchedulingFailureReason.SlotTaken);
        }
    }

    public async Task<Result<ScheduledSession, SchedulingFailureReason>> MoveAsync(
        Guid professionalId, Guid sessionId, DateTimeOffset newStartsAt, int newDurationMinutes, CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(professionalId, cancellationToken);
        if (authorizationFailure is not null)
        {
            return Result<ScheduledSession, SchedulingFailureReason>.Failure(authorizationFailure.Value);
        }

        try
        {
            return await store.MoveAsync(professionalId, sessionId, newStartsAt.ToUniversalTime(), newDurationMinutes, cancellationToken);
        }
        catch (ScheduledSessionSlotConflictException)
        {
            return Result<ScheduledSession, SchedulingFailureReason>.Failure(SchedulingFailureReason.SlotTaken);
        }
    }

    public async Task<Result<ScheduledSession, SchedulingFailureReason>> CancelAsync(Guid professionalId, Guid sessionId, CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(professionalId, cancellationToken);
        if (authorizationFailure is not null)
        {
            return Result<ScheduledSession, SchedulingFailureReason>.Failure(authorizationFailure.Value);
        }

        return await store.CancelAsync(professionalId, sessionId, DateTimeOffset.UtcNow, cancellationToken);
    }

    /// <summary>
    /// Same "account exists, and is an active Professional" preamble for Schedule/Move/Cancel --
    /// reuses <see cref="AccountAuthorizationGuard.CanCreatePatientRecords"/>, the same guard
    /// <c>PatientService</c> uses, since scheduling a session carries the same authorization risk
    /// (it names a real patient) and must not be reachable by an account whose professional
    /// verification has since been revoked.
    /// </summary>
    private async Task<SchedulingFailureReason?> AuthorizeAsync(Guid professionalId, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(professionalId, cancellationToken);
        if (account is null)
        {
            return SchedulingFailureReason.AccountNotFound;
        }

        if (!AccountAuthorizationGuard.CanCreatePatientRecords(account))
        {
            return SchedulingFailureReason.NotAuthorizedToSchedule;
        }

        return null;
    }
}
