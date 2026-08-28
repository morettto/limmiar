using Api.Accounts;

namespace Api.Notes;

public sealed class NoteService(IAccountStore accounts, NoteSignatureStore store)
{
    public async Task<SignNoteResult> SignAsync(
        Guid professionalId, Guid noteId, int revisao, byte[] signature, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(professionalId, cancellationToken);
        if (account is null)
        {
            return SignNoteResult.Failure(SignNoteFailureReason.AccountNotFound);
        }

        // Same guard as PatientService.CreatePatientAsync/AppendEntryAsync -- signing a note
        // carries the same authorization risk as creating or appending clinical content.
        if (!AccountAuthorizationGuard.CanCreatePatientRecords(account))
        {
            return SignNoteResult.Failure(SignNoteFailureReason.NotAuthorizedToCreateRecords);
        }

        var entry = new NoteSignature(professionalId, noteId, revisao, signature, DateTimeOffset.UtcNow);
        var inserted = await store.InsertAsync(entry, cancellationToken);
        if (inserted is null)
        {
            return SignNoteResult.Failure(SignNoteFailureReason.AlreadySigned);
        }

        return SignNoteResult.Success(inserted);
    }

    public Task<NoteSignature?> GetSignatureAsync(Guid professionalId, Guid noteId, CancellationToken cancellationToken) =>
        store.FindAsync(professionalId, noteId, cancellationToken);
}
