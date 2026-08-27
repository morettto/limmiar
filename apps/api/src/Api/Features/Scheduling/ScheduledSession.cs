namespace Api.Scheduling;

/// <summary>
/// One row of <c>scheduled_sessions</c>. Unlike <c>PatientRecordEntry</c>, <see cref="StartsAt"/>
/// and <see cref="DurationMinutes"/> are server-visible metadata, not ciphertext -- the server
/// needs a comparable value to detect a real concurrent double-booking (see migration
/// 0004_create_scheduled_sessions.sql and ADR-S04-02). <see cref="PatientId"/> stays a bare
/// uuid, the same AAD-bound reference pattern as <c>PatientRecordEntry.PatientId</c> -- no
/// clear-text field about the person is ever a property of this type.
/// </summary>
public sealed record ScheduledSession(
    Guid Id,
    Guid TenantId,
    Guid PatientId,
    DateTimeOffset StartsAt,
    int DurationMinutes,
    bool RecordingActive,
    DateTimeOffset? CancelledAt,
    DateTimeOffset CreatedAt);
