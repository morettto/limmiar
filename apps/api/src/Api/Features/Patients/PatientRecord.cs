namespace Api.Patients;

/// <summary>
/// The projected view of a patient's append-only record: <see cref="PatientRecordProjection.Project"/>
/// builds this from the raw <see cref="PatientRecordEntry"/> rows.
/// </summary>
public sealed record PatientRecord(
    Guid PatientId,
    byte[] WrappedDek,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastEntryAt,
    IReadOnlyList<PatientRecordEntry> Entries);
