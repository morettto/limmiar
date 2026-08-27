namespace Api.Patients;

/// <summary>
/// Thrown by <see cref="PatientRecordStore.AppendAsync"/> when the (tenant_id, patient_id,
/// sequence) unique constraint rejects the insert -- the DB-layer proof that no entry can
/// ever be silently overwritten (re-using a sequence number is a conflict, not a write).
/// </summary>
public sealed class PatientRecordSequenceConflictException : Exception
{
}
