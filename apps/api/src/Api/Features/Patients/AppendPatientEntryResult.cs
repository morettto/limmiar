namespace Api.Patients;

public enum AppendPatientEntryFailureReason
{
    AccountNotFound,
    NotAuthorizedToCreateRecords,
    PatientNotFound,
    InvalidSequence,
    SequenceConflict,
}

public sealed class AppendPatientEntryResult
{
    public required bool Succeeded { get; init; }

    public PatientRecordEntry? Entry { get; init; }

    public AppendPatientEntryFailureReason? FailureReason { get; init; }

    public static AppendPatientEntryResult Success(PatientRecordEntry entry) =>
        new() { Succeeded = true, Entry = entry };

    public static AppendPatientEntryResult Failure(AppendPatientEntryFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
