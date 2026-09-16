namespace Api.PatientLinks;

public sealed class SharingPreferencesStore(PatientLinkStore store)
{
    public Task<SharingPreferences?> GetPreferencesAsync(Guid accountId, CancellationToken cancellationToken) =>
        store.GetPreferencesAsync(accountId, cancellationToken);

    public Task<SharingPreferences?> PutPreferencesAsync(Guid accountId, long expectedVersion, byte[] wrappedDek, byte[] ciphertext, CancellationToken cancellationToken) =>
        store.PutPreferencesAsync(accountId, expectedVersion, wrappedDek, ciphertext, cancellationToken);
}
