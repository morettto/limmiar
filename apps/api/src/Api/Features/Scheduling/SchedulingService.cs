using Api.Accounts;

namespace Api.Scheduling;

public sealed class SchedulingService(IAccountStore accounts, ScheduledSessionStore store)
{
    public async Task<SchedulingResult> ScheduleAsync(
        Guid professionalId, Guid patientId, DateTimeOffset startsAt, int durationMinutes, CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(professionalId, cancellationToken);
        if (authorizationFailure is not null)
        {
            return SchedulingResult.Failure(authorizationFailure.Value);
        }

        try
        {
            // timestamptz requires a zero-offset (UTC) value from Npgsql.
            var session = await store.InsertAsync(professionalId, patientId, startsAt.ToUniversalTime(), durationMinutes, cancellationToken);
            return SchedulingResult.Success(session);
        }
        catch (ScheduledSessionSlotConflictException)
        {
            return SchedulingResult.Failure(SchedulingFailureReason.SlotTaken);
        }
    }

    public async Task<SchedulingResult> MoveAsync(
        Guid professionalId, Guid sessionId, DateTimeOffset newStartsAt, int newDurationMinutes, CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(professionalId, cancellationToken);
        if (authorizationFailure is not null)
        {
            return SchedulingResult.Failure(authorizationFailure.Value);
        }

        try
        {
            return await store.MoveAsync(professionalId, sessionId, newStartsAt.ToUniversalTime(), newDurationMinutes, cancellationToken);
        }
        catch (ScheduledSessionSlotConflictException)
        {
            return SchedulingResult.Failure(SchedulingFailureReason.SlotTaken);
        }
    }

    public async Task<SchedulingResult> CancelAsync(Guid professionalId, Guid sessionId, CancellationToken cancellationToken)
    {
        var authorizationFailure = await AuthorizeAsync(professionalId, cancellationToken);
        if (authorizationFailure is not null)
        {
            return SchedulingResult.Failure(authorizationFailure.Value);
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
