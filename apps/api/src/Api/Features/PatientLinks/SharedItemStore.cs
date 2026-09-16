using Api.Data;
using Npgsql;

namespace Api.PatientLinks;

public sealed class SharedItemStore(NpgsqlDataSource dataSource)
{
    public async Task<bool> ShareAsync(Guid patientAccountId, Guid professionalAccountId, byte[] ciphertext, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(patientAccountId, cancellationToken);
        await using var command = scope.CreateCommand("""
            INSERT INTO shared_items (patient_account_id, professional_account_id, shared_at, ciphertext)
            SELECT @patientAccountId, @professionalAccountId, now(), @ciphertext
            WHERE EXISTS (SELECT 1 FROM patient_links
                WHERE patient_account_id = @patientAccountId AND professional_account_id = @professionalAccountId
                  AND unlinked_at IS NULL FOR SHARE)
            RETURNING id
            """);
        command.Parameters.AddWithValue("patientAccountId", patientAccountId);
        command.Parameters.AddWithValue("professionalAccountId", professionalAccountId);
        command.Parameters.AddWithValue("ciphertext", ciphertext);
        var insertedId = await command.ExecuteScalarAsync(cancellationToken);
        await scope.Transaction.CommitAsync(cancellationToken);
        return insertedId is not null;
    }

    public async Task<IReadOnlyList<SharedItem>?> ListSharedAsync(Guid professionalAccountId, Guid patientAccountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(professionalAccountId, cancellationToken);
        await using var command = scope.CreateCommand("""
            WITH link_state AS (SELECT EXISTS (SELECT 1 FROM patient_links
                WHERE patient_account_id = @patientAccountId AND professional_account_id = @professionalAccountId
                  AND unlinked_at IS NULL) AS is_linked)
            SELECT link_state.is_linked, si.shared_at, si.ciphertext FROM link_state
            LEFT JOIN shared_items si ON si.patient_account_id = @patientAccountId
                AND si.professional_account_id = @professionalAccountId ORDER BY si.id
            """);
        command.Parameters.AddWithValue("patientAccountId", patientAccountId);
        command.Parameters.AddWithValue("professionalAccountId", professionalAccountId);
        var items = new List<SharedItem>();
        var linked = false;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                if (!reader.GetBoolean(0)) break;
                linked = true;
                if (!reader.IsDBNull(1)) items.Add(new SharedItem(professionalAccountId, patientAccountId,
                    reader.GetFieldValue<DateTimeOffset>(1), reader.GetFieldValue<byte[]>(2)));
            }
        }
        await scope.Transaction.CommitAsync(cancellationToken);
        return linked ? items : null;
    }

    public async Task<IReadOnlyList<ReceivedShare>> ListReceivedSharesAsync(Guid professionalAccountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(professionalAccountId, cancellationToken);
        await using var command = scope.CreateCommand("""
            WITH latest_links AS (SELECT DISTINCT ON (patient_account_id) patient_account_id, patient_id, linked_at, unlinked_at
                FROM patient_links WHERE professional_account_id = @professionalAccountId
                ORDER BY patient_account_id, linked_at DESC)
            SELECT ll.patient_account_id, ll.patient_id, ll.linked_at, ll.unlinked_at, kp.public_key,
                   si.shared_at, si.ciphertext FROM latest_links ll
            LEFT JOIN account_key_pairs kp ON kp.account_id = ll.patient_account_id
            LEFT JOIN shared_items si ON si.patient_account_id = ll.patient_account_id
                                      AND si.professional_account_id = @professionalAccountId
            ORDER BY ll.linked_at, si.id
            """);
        command.Parameters.AddWithValue("professionalAccountId", professionalAccountId);
        var order = new List<Guid>();
        var byPatient = new Dictionary<Guid, (Guid PatientId, DateTimeOffset LinkedAt, DateTimeOffset? UnlinkedAt, byte[]? PeerPublicKey, List<SharedItem> Items)>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                var patientAccountId = reader.GetGuid(0);
                if (!byPatient.TryGetValue(patientAccountId, out var entry))
                {
                    entry = (reader.GetGuid(1), reader.GetFieldValue<DateTimeOffset>(2),
                        reader.IsDBNull(3) ? null : reader.GetFieldValue<DateTimeOffset>(3),
                        reader.IsDBNull(4) ? null : reader.GetFieldValue<byte[]>(4), []);
                    byPatient[patientAccountId] = entry;
                    order.Add(patientAccountId);
                }
                if (!reader.IsDBNull(5)) entry.Items.Add(new SharedItem(professionalAccountId, patientAccountId,
                    reader.GetFieldValue<DateTimeOffset>(5), reader.GetFieldValue<byte[]>(6)));
            }
        }
        await scope.Transaction.CommitAsync(cancellationToken);
        return order.Select(patientAccountId => { var entry = byPatient[patientAccountId];
            return new ReceivedShare(patientAccountId, entry.PatientId, entry.LinkedAt, entry.UnlinkedAt, entry.PeerPublicKey, entry.Items); }).ToArray();
    }
}
