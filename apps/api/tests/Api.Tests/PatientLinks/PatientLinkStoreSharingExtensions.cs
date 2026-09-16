namespace Api.Tests.PatientLinks;

internal static class PatientLinkStoreSharingExtensions
{
    public static Task<bool> ShareAsync(this Api.PatientLinks.PatientLinkStore store, Guid patientAccountId, Guid professionalAccountId, byte[] ciphertext, CancellationToken cancellationToken) =>
        new Api.PatientLinks.SharedItemStore(store.DataSource).ShareAsync(patientAccountId, professionalAccountId, ciphertext, cancellationToken);

    public static Task<IReadOnlyList<Api.PatientLinks.SharedItem>?> ListSharedAsync(this Api.PatientLinks.PatientLinkStore store, Guid professionalAccountId, Guid patientAccountId, CancellationToken cancellationToken) =>
        new Api.PatientLinks.SharedItemStore(store.DataSource).ListSharedAsync(professionalAccountId, patientAccountId, cancellationToken);

    public static Task<IReadOnlyList<Api.PatientLinks.ReceivedShare>> ListReceivedSharesAsync(this Api.PatientLinks.PatientLinkStore store, Guid professionalAccountId, CancellationToken cancellationToken) =>
        new Api.PatientLinks.SharedItemStore(store.DataSource).ListReceivedSharesAsync(professionalAccountId, cancellationToken);

    public static Task<Api.PatientLinks.SharingPreferences?> GetPreferencesAsync(this Api.PatientLinks.PatientLinkStore store, Guid accountId, CancellationToken cancellationToken) =>
        new Api.PatientLinks.SharingPreferencesStore(store.DataSource).GetPreferencesAsync(accountId, cancellationToken);

    public static Task<Api.PatientLinks.SharingPreferences?> PutPreferencesAsync(this Api.PatientLinks.PatientLinkStore store, Guid accountId, long expectedVersion, byte[] wrappedDek, byte[] ciphertext, CancellationToken cancellationToken) =>
        new Api.PatientLinks.SharingPreferencesStore(store.DataSource).PutPreferencesAsync(accountId, expectedVersion, wrappedDek, ciphertext, cancellationToken);
}
