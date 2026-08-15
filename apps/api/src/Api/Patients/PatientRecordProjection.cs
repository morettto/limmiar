namespace Api.Patients;

/// <summary>
/// Builds the read-side <see cref="PatientRecord"/> view from the raw append-only entries.
/// Pure function, no I/O -- <see cref="PatientRecordStore"/> owns fetching the entries.
/// </summary>
public static class PatientRecordProjection
{
    public static PatientRecord? Project(IReadOnlyList<PatientRecordEntry> entries)
    {
        if (entries.Count == 0)
        {
            return null;
        }

        var ordered = entries.OrderBy(e => e.Sequence).ToList();
        var first = ordered[0];
        if (first.Sequence != 1 || first.WrappedDek is null)
        {
            return null;
        }

        return new PatientRecord(
            first.PatientId,
            first.WrappedDek,
            first.CreatedAt,
            ordered[^1].CreatedAt,
            ordered);
    }
}
