namespace Api.Patients;

public enum CreatePatientFailureReason
{
    AccountNotFound,
    NotAuthorizedToCreateRecords,
    PatientAlreadyExists,
}

public sealed class CreatePatientResult
{
    public required bool Succeeded { get; init; }

    public PatientRecordEntry? Entry { get; init; }

    public CreatePatientFailureReason? FailureReason { get; init; }

    public static CreatePatientResult Success(PatientRecordEntry entry) =>
        new() { Succeeded = true, Entry = entry };

    public static CreatePatientResult Failure(CreatePatientFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
