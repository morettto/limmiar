namespace Api.PatientLinks;

public sealed class SharedItemStore(PatientLinkStore store)
{
    public Task<bool> ShareAsync(Guid patientAccountId, Guid professionalAccountId, byte[] ciphertext, CancellationToken cancellationToken) =>
        store.ShareAsync(patientAccountId, professionalAccountId, ciphertext, cancellationToken);

    public Task<IReadOnlyList<SharedItem>?> ListSharedAsync(Guid professionalAccountId, Guid patientAccountId, CancellationToken cancellationToken) =>
        store.ListSharedAsync(professionalAccountId, patientAccountId, cancellationToken);

    public Task<IReadOnlyList<ReceivedShare>> ListReceivedSharesAsync(Guid professionalAccountId, CancellationToken cancellationToken) =>
        store.ListReceivedSharesAsync(professionalAccountId, cancellationToken);
}
