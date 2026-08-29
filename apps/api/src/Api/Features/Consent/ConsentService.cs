using Api.Accounts;

namespace Api.Consent;

public sealed class ConsentService(IAccountStore accounts, ConsentEventStore store)
{
    /// <summary>
    /// Records one consent decision for one purpose. Same guard as
    /// <see cref="Api.Notes.NoteService.SignAsync"/>: recording a consent decision carries the
    /// same authorization risk as creating or appending clinical content, so it reuses
    /// <see cref="AccountAuthorizationGuard.CanCreatePatientRecords"/>. <paramref name="professionalId"/>
    /// doubles as the tenant id, same convention as every other tenant-scoped table in this
    /// repository.
    /// </summary>
    public async Task<RecordConsentResult> RecordAsync(
        Guid professionalId, Guid patientId, ConsentPurpose purpose, ConsentDecision decision, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(professionalId, cancellationToken);
        if (account is null)
        {
            return RecordConsentResult.Failure(RecordConsentFailureReason.AccountNotFound);
        }

        if (!AccountAuthorizationGuard.CanCreatePatientRecords(account))
        {
            return RecordConsentResult.Failure(RecordConsentFailureReason.NotAuthorizedToCreateRecords);
        }

        var evt = new ConsentEvent(professionalId, patientId, purpose, decision, default);
        var inserted = await store.InsertAsync(evt, cancellationToken);
        return RecordConsentResult.Success(inserted);
    }

    /// <summary>
    /// The current status of both purposes for a patient, each an independent fold
    /// (<see cref="ConsentState.Fold"/>) over the same event list. No account lookup here --
    /// the caller (<see cref="ConsentEndpoints"/>) has already proven, via the bearer token,
    /// that <paramref name="professionalId"/> is the caller's own account.
    /// </summary>
    public async Task<ConsentSnapshot> SnapshotAsync(Guid professionalId, Guid patientId, CancellationToken cancellationToken)
    {
        var events = await store.ListAsync(professionalId, patientId, cancellationToken);
        return new ConsentSnapshot(
            ConsentState.Fold(events, ConsentPurpose.Gravacao),
            ConsentState.Fold(events, ConsentPurpose.AnaliseIa));
    }
}
