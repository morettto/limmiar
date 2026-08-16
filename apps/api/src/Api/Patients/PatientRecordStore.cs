using Api.Data;
using Npgsql;

namespace Api.Patients;

/// <summary>
/// Postgres-backed store for <c>patient_record_entries</c>. Single implementation, no
/// interface -- the ticket mandates a real Testcontainers Postgres for the RLS proof, so
/// there is no in-memory fake to substitute it for.
/// </summary>
public sealed class PatientRecordStore(NpgsqlDataSource dataSource)
{
    /// <summary>
    /// Inserts one entry inside a tenant-scoped transaction (see
    /// <see cref="NpgsqlDataSourceTenantExtensions.OpenTenantScopedTransactionAsync"/>) --
    /// forging an entry under a tenant_id the caller does not control is rejected by
    /// Postgres' RLS WITH CHECK clause, not just by application code.
    /// </summary>
    public async Task<PatientRecordEntry> AppendAsync(PatientRecordEntry entry, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(entry.TenantId, cancellationToken);

        await using var insertCommand = scope.Connection.CreateCommand();
        insertCommand.Transaction = scope.Transaction;
        insertCommand.CommandText = """
            INSERT INTO patient_record_entries (id, tenant_id, patient_id, sequence, wrapped_dek, ciphertext, created_at)
            VALUES (@id, @tenantId, @patientId, @sequence, @wrappedDek, @ciphertext, @createdAt)
            RETURNING id, created_at
            """;
        insertCommand.Parameters.AddWithValue("id", entry.Id);
        insertCommand.Parameters.AddWithValue("tenantId", entry.TenantId);
        insertCommand.Parameters.AddWithValue("patientId", entry.PatientId);
        insertCommand.Parameters.AddWithValue("sequence", entry.Sequence);
        insertCommand.Parameters.AddWithValue("wrappedDek", (object?)entry.WrappedDek ?? DBNull.Value);
        insertCommand.Parameters.AddWithValue("ciphertext", entry.Ciphertext);
        insertCommand.Parameters.AddWithValue("createdAt", entry.CreatedAt);

        Guid insertedId;
        DateTimeOffset insertedCreatedAt;
        try
        {
            await using var reader = await insertCommand.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            insertedId = reader.GetGuid(0);
            insertedCreatedAt = reader.GetFieldValue<DateTimeOffset>(1);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new PatientRecordSequenceConflictException();
        }

        await scope.Transaction.CommitAsync(cancellationToken);

        return entry with { Id = insertedId, CreatedAt = insertedCreatedAt };
    }

    /// <summary>
    /// Lists entries for one patient, tenant-scoped the same way as <see cref="AppendAsync"/>.
    /// A different tenant's context sees zero rows -- RLS filters them out, not an
    /// application-level check -- which is what proves criterion "RLS impede o profissional A
    /// de ler a ficha do profissional B".
    /// </summary>
    public async Task<IReadOnlyList<PatientRecordEntry>> ListAsync(
        Guid tenantId, Guid patientId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = """
            SELECT id, tenant_id, patient_id, sequence, wrapped_dek, ciphertext, created_at
            FROM patient_record_entries
            WHERE patient_id = @patientId
            ORDER BY sequence
            """;
        selectCommand.Parameters.AddWithValue("patientId", patientId);

        var results = new List<PatientRecordEntry>();
        await using (var reader = await selectCommand.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                results.Add(new PatientRecordEntry(
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    reader.GetGuid(2),
                    reader.GetInt32(3),
                    reader.IsDBNull(4) ? null : (byte[])reader[4],
                    (byte[])reader[5],
                    reader.GetFieldValue<DateTimeOffset>(6)));
            }
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return results;
    }

    /// <summary>
    /// Every patient's sequence-1 (creation) entry, newest first -- the raw material for the
    /// carteira listing. Tenant isolation comes from the same RLS policy as <see cref="ListAsync"/>
    /// (via <see cref="NpgsqlDataSourceTenantExtensions.OpenTenantScopedTransactionAsync"/>), not
    /// from a WHERE tenant_id clause here.
    /// </summary>
    /// <remarks>
    /// Unlike <see cref="ListAsync"/>, this never needs the <c>WrappedDek</c> null check -- the
    /// <c>WHERE sequence = 1</c> filter plus migration 0002's <c>wrapped_dek_only_on_sequence_1</c>
    /// check constraint guarantee every row here has a non-null wrapped DEK.
    /// </remarks>
    public async Task<IReadOnlyList<PatientRecordEntry>> ListCreationEntriesAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = """
            SELECT id, tenant_id, patient_id, sequence, wrapped_dek, ciphertext, created_at
            FROM patient_record_entries
            WHERE sequence = 1
            ORDER BY created_at DESC
            """;

        var results = new List<PatientRecordEntry>();
        await using (var reader = await selectCommand.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                results.Add(new PatientRecordEntry(
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    reader.GetGuid(2),
                    reader.GetInt32(3),
                    (byte[])reader[4],
                    (byte[])reader[5],
                    reader.GetFieldValue<DateTimeOffset>(6)));
            }
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return results;
    }

    /// <summary>
    /// Highest existing sequence for one patient, or null if the patient has no entries
    /// (doesn't exist under this tenant). Used to check existence and to enforce strict
    /// "next sequence must be lastSequence + 1" without paying to fetch every prior
    /// entry's ciphertext just to answer a yes/no + one-integer question.
    /// </summary>
    public async Task<int?> GetLastSequenceAsync(Guid tenantId, Guid patientId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = "SELECT MAX(sequence) FROM patient_record_entries WHERE tenant_id = @tenantId AND patient_id = @patientId";
        command.Parameters.AddWithValue("tenantId", tenantId);
        command.Parameters.AddWithValue("patientId", patientId);

        var result = await command.ExecuteScalarAsync(cancellationToken);

        await scope.Transaction.CommitAsync(cancellationToken);

        return result is null or DBNull ? null : (int)result;
    }
}
