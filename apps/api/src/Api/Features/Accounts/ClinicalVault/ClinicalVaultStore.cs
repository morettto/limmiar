using System.Security.Cryptography;
using System.Text.Json;
using Api.Data;
using Npgsql;
using NpgsqlTypes;

namespace Api.Accounts;

public sealed class ClinicalVaultStore(NpgsqlDataSource dataSource)
{
    public async Task<VaultDocument?> GetAsync(Guid accountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);
        await using var command = scope.CreateCommand();
        command.CommandText = "SELECT revision, key_envelope, recovery_slots::text FROM clinical_vaults WHERE account_id = @accountId";
        command.Parameters.AddWithValue("accountId", accountId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        var slots = JsonSerializer.Deserialize(reader.GetString(2), AccountsJsonContext.Default.VaultRecoverySlotStoredArray)!;
        return new VaultDocument(reader.GetGuid(0), reader.GetFieldValue<byte[]>(1),
            slots.Select(slot => new VaultRecoverySlot(slot.Id, slot.Envelope)).ToArray());
    }

    public async Task<bool> CreateAsync(Guid accountId, VaultWrite document, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);
        await using var command = scope.CreateCommand();
        command.CommandText = """
            INSERT INTO clinical_vaults (account_id, revision, key_envelope, recovery_slots)
            SELECT @accountId, @revision, @keyEnvelope, @slots
            WHERE NOT EXISTS (SELECT 1 FROM patient_record_entries WHERE tenant_id = @accountId)
              AND NOT EXISTS (SELECT 1 FROM professional_materials WHERE tenant_id = @accountId)
              AND NOT EXISTS (SELECT 1 FROM account_key_pairs WHERE account_id = @accountId)
              AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = @accountId AND voice_wrapped_dek IS NOT NULL)
            ON CONFLICT (account_id) DO NOTHING
            """;
        Parameters(command, accountId, document);
        var changed = await command.ExecuteNonQueryAsync(cancellationToken) == 1;
        await scope.Transaction.CommitAsync(cancellationToken);
        return changed;
    }

    public async Task<bool> RecoverAsync(Guid accountId, RecoverVaultRequest request, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);
        await using var read = scope.CreateCommand();
        read.CommandText = "SELECT recovery_slots::text FROM clinical_vaults WHERE account_id = @accountId AND revision = @revision";
        read.Parameters.AddWithValue("accountId", accountId);
        read.Parameters.AddWithValue("revision", request.ExpectedRevision);
        var json = await read.ExecuteScalarAsync(cancellationToken) as string;
        if (json is null) return false;
        var slots = JsonSerializer.Deserialize(json, AccountsJsonContext.Default.VaultRecoverySlotStoredArray)!;
        var slot = slots.SingleOrDefault(slot => slot.Id == request.RecoveryId);
        if (slot is null || !CryptographicOperations.FixedTimeEquals(slot.VerifierHash, SHA256.HashData(request.RecoveryVerifier))) return false;
        await using var update = scope.CreateCommand();
        update.CommandText = """
            UPDATE clinical_vaults SET revision = @revision, key_envelope = @keyEnvelope, recovery_slots = @slots
            WHERE account_id = @accountId AND revision = @expectedRevision
            """;
        Parameters(update, accountId, request.Document);
        update.Parameters.AddWithValue("expectedRevision", request.ExpectedRevision);
        var changed = await update.ExecuteNonQueryAsync(cancellationToken) == 1;
        await scope.Transaction.CommitAsync(cancellationToken);
        return changed;
    }

    private static void Parameters(NpgsqlCommand command, Guid accountId, VaultWrite document)
    {
        command.Parameters.AddWithValue("accountId", accountId);
        command.Parameters.AddWithValue("revision", document.Revision);
        command.Parameters.AddWithValue("keyEnvelope", document.KeyEnvelope);
        command.Parameters.AddWithValue("slots", NpgsqlDbType.Jsonb,
            JsonSerializer.Serialize(ClinicalVaultEndpoints.Stored(document), AccountsJsonContext.Default.VaultRecoverySlotStoredArray));
    }
}
