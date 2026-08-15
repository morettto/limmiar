using Api.Accounts;

namespace Api.Patients;

public sealed class PatientService(IAccountStore accounts, PatientRecordStore store)
{
    public async Task<CreatePatientResult> CreatePatientAsync(
        Guid professionalId, Guid patientId, byte[] wrappedDek, byte[] ciphertext, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(professionalId, cancellationToken);
        if (account is null)
        {
            return CreatePatientResult.Failure(CreatePatientFailureReason.AccountNotFound);
        }

        if (!AccountAuthorizationGuard.CanCreatePatientRecords(account))
        {
            return CreatePatientResult.Failure(CreatePatientFailureReason.NotAuthorizedToCreateRecords);
        }

        // Sequence 1 is always the creation entry -- it alone carries the wrapped DEK (migration's wrapped_dek_only_on_sequence_1 check).
        const int creationSequence = 1;
        var entry = new PatientRecordEntry(
            Guid.NewGuid(), professionalId, patientId, creationSequence, wrappedDek, ciphertext, DateTimeOffset.UtcNow);

        try
        {
            var inserted = await store.AppendAsync(entry, cancellationToken);
            return CreatePatientResult.Success(inserted);
        }
        catch (PatientRecordSequenceConflictException)
        {
            return CreatePatientResult.Failure(CreatePatientFailureReason.PatientAlreadyExists);
        }
    }

    public async Task<AppendPatientEntryResult> AppendEntryAsync(
        Guid professionalId, Guid patientId, int sequence, byte[] ciphertext, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(professionalId, cancellationToken);
        if (account is null)
        {
            return AppendPatientEntryResult.Failure(AppendPatientEntryFailureReason.AccountNotFound);
        }

        // Same guard as CreatePatientAsync -- appending new clinical content carries the same
        // authorization risk as creating a record, so it must not be reachable by an account
        // whose professional verification has since been revoked (see AccountAuthorizationGuard).
        if (!AccountAuthorizationGuard.CanCreatePatientRecords(account))
        {
            return AppendPatientEntryResult.Failure(AppendPatientEntryFailureReason.NotAuthorizedToCreateRecords);
        }

        var lastSequence = await store.GetLastSequenceAsync(professionalId, patientId, cancellationToken);
        if (lastSequence is null)
        {
            return AppendPatientEntryResult.Failure(AppendPatientEntryFailureReason.PatientNotFound);
        }

        // Re-using an already-taken (or earlier) sequence is a conflict -- the ticket's own
        // words, "nenhuma operação consegue sobrescrever entrada de prontuário". Jumping ahead
        // of the next expected value is a different failure: it would leave a permanent gap
        // that PatientRecordProjection's ordering assumptions don't expect, so it's rejected as
        // invalid rather than silently accepted or miscategorized as a conflict.
        if (sequence <= lastSequence.Value)
        {
            return AppendPatientEntryResult.Failure(AppendPatientEntryFailureReason.SequenceConflict);
        }

        if (sequence != lastSequence.Value + 1)
        {
            return AppendPatientEntryResult.Failure(AppendPatientEntryFailureReason.InvalidSequence);
        }

        var entry = new PatientRecordEntry(
            Guid.NewGuid(), professionalId, patientId, sequence, null, ciphertext, DateTimeOffset.UtcNow);

        // No try/catch here (unlike CreatePatientAsync): the sequence<=lastSequence check above
        // already rejects every sequential/deterministic reuse. The only way store.AppendAsync
        // can still throw PatientRecordSequenceConflictException from this call site is two
        // requests both reading the same lastSequence before either commits -- a real but
        // narrow race that has no deterministic test without an artificial delay seam in
        // production code. Left uncaught, it surfaces as a plain 500 via
        // GlobalProblemExceptionHandler (safe: no data corruption, the UNIQUE constraint still
        // did its job) rather than a polished 409 for that one narrow interleaving. Revisit if
        // concurrent double-submits on the exact same next sequence turn out to be common
        // enough in practice to be worth the extra path.
        var inserted = await store.AppendAsync(entry, cancellationToken);
        return AppendPatientEntryResult.Success(inserted);
    }

    public async Task<PatientRecord?> GetPatientAsync(Guid professionalId, Guid patientId, CancellationToken cancellationToken)
    {
        var entries = await store.ListAsync(professionalId, patientId, cancellationToken);
        return PatientRecordProjection.Project(entries);
    }
}
