namespace Api.Patients;

public static class PatientsProblemCodes
{
    public const string PatientsNotFound = "patients.not_found";

    public const string PatientsNotAuthorizedToCreateRecords = "patients.not_authorized_to_create_records";

    public const string PatientsEntrySequenceConflict = "patients.entry_sequence_conflict";
}
