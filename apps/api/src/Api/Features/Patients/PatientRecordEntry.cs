namespace Api.Patients;

/// <summary>
/// One row of the append-only <c>patient_record_entries</c> table. Sequence 1 carries the
/// wrapped DEK for the patient; every other sequence has <see cref="WrappedDek"/> null (see
/// migration 0002's <c>wrapped_dek_only_on_sequence_1</c> check). <see cref="Ciphertext"/> is
/// opaque to the server -- no clinical field is ever a property of this type.
///
/// The generated record equality/GetHashCode compare <see cref="WrappedDek"/> and
/// <see cref="Ciphertext"/> by reference, not by content -- byte[] has no structural equality
/// in C#. Nothing in this codebase currently relies on two entries with equal-but-distinct
/// byte[] instances comparing equal (tests assert on individual fields, not whole-record
/// equality); if that ever changes, this record needs hand-written Equals/GetHashCode.
/// </summary>
public sealed record PatientRecordEntry(
    Guid Id,
    Guid TenantId,
    Guid PatientId,
    int Sequence,
    byte[]? WrappedDek,
    byte[] Ciphertext,
    DateTimeOffset CreatedAt);
