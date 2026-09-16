using Api.Data;
using Npgsql;

namespace Api.PatientLinks;

public sealed class SharingPreferencesStore(NpgsqlDataSource dataSource)
{
    public async Task<SharingPreferences?> GetPreferencesAsync(Guid accountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);
        var result = await scope.QuerySingleAsync("SELECT version, wrapped_dek, ciphertext FROM sharing_preferences WHERE account_id = @accountId",
            ReadPreferences, cancellationToken, command => command.Parameters.AddWithValue("accountId", accountId));
        await scope.Transaction.CommitAsync(cancellationToken);
        return result;
    }

    public async Task<SharingPreferences?> PutPreferencesAsync(Guid accountId, long expectedVersion, byte[] wrappedDek, byte[] ciphertext, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);
        await using var command = scope.CreateCommand(expectedVersion == 0
            ? "INSERT INTO sharing_preferences (account_id, version, wrapped_dek, ciphertext) VALUES (@accountId, 1, @wrappedDek, @ciphertext) ON CONFLICT (account_id) DO NOTHING RETURNING version, wrapped_dek, ciphertext"
            : "UPDATE sharing_preferences SET version = @newVersion, wrapped_dek = @wrappedDek, ciphertext = @ciphertext, updated_at = now() WHERE account_id = @accountId AND version = @expectedVersion RETURNING version, wrapped_dek, ciphertext");
        command.Parameters.AddWithValue("accountId", accountId);
        command.Parameters.AddWithValue("wrappedDek", wrappedDek);
        command.Parameters.AddWithValue("ciphertext", ciphertext);
        if (expectedVersion != 0)
        {
            command.Parameters.AddWithValue("expectedVersion", expectedVersion);
            command.Parameters.AddWithValue("newVersion", expectedVersion + 1);
        }
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = await reader.ReadAsync(cancellationToken) ? ReadPreferences(reader) : null;
        await reader.DisposeAsync();
        await scope.Transaction.CommitAsync(cancellationToken);
        return result;
    }

    private static SharingPreferences ReadPreferences(NpgsqlDataReader reader) =>
        new(reader.GetInt64(0), reader.GetFieldValue<byte[]>(1), reader.GetFieldValue<byte[]>(2));
}
