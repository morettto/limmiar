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

public sealed class SchedulingResult
{
    public required bool Succeeded { get; init; }

    public ScheduledSession? Session { get; init; }

    public SchedulingFailureReason? FailureReason { get; init; }

    public static SchedulingResult Success(ScheduledSession session) =>
        new() { Succeeded = true, Session = session };

    public static SchedulingResult Failure(SchedulingFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
