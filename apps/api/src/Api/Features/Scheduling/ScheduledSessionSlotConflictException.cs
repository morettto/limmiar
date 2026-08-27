namespace Api.Scheduling;

/// <summary>
/// Thrown by <see cref="ScheduledSessionStore"/> when the
/// <c>scheduled_sessions_live_slot_uq</c> partial unique index rejects an insert/update --
/// the DB-layer proof that two concurrent transactions for the same tenant+starts_at can
/// never both persist a live row (acceptance criterion 1). Same pattern as
/// <c>Api.Patients.PatientRecordSequenceConflictException</c>.
/// </summary>
public sealed class ScheduledSessionSlotConflictException : Exception
{
}
