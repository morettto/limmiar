using Api.Data;
using Npgsql;

namespace Api.Notes;

/// <summary>
/// Postgres-backed store for <c>note_signatures</c>. Single implementation, no interface --
/// same reasoning as <c>PatientRecordStore</c>: the RLS proof needs a real Testcontainers
/// Postgres, so there is no in-memory fake to substitute it for.
/// </summary>
public sealed class NoteSignatureStore(NpgsqlDataSource dataSource)
{
    /// <summary>
    /// Inserts one signature inside a tenant-scoped transaction. Returns <c>null</c> instead
    /// of throwing on a <c>UniqueViolation</c> against the (tenant_id, note_id) primary key --
    /// deliberate divergence from <see cref="PatientRecordStore.AppendAsync"/>, whose
    /// UniqueViolation models a rare concurrent race that application logic already guards
    /// against. Here a second signature attempt for the same note is the ordinary path a real
    /// user hits (double submit, stale UI state after a reload), not an exceptional one -- an
    /// exception for the normal path would be the actual gambiarra.
    /// </summary>
    public async Task<NoteSignature?> InsertAsync(NoteSignature signature, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(signature.TenantId, cancellationToken);

        await using var insertCommand = scope.Connection.CreateCommand();
        insertCommand.Transaction = scope.Transaction;
        insertCommand.CommandText = """
            INSERT INTO note_signatures (tenant_id, note_id, revisao, signature)
            VALUES (@tenantId, @noteId, @revisao, @signature)
            RETURNING signed_at
            """;
        insertCommand.Parameters.AddWithValue("tenantId", signature.TenantId);
        insertCommand.Parameters.AddWithValue("noteId", signature.NoteId);
        insertCommand.Parameters.AddWithValue("revisao", signature.Revisao);
        insertCommand.Parameters.AddWithValue("signature", signature.Signature);

        DateTimeOffset insertedSignedAt;
        try
        {
            await using var reader = await insertCommand.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            insertedSignedAt = reader.GetFieldValue<DateTimeOffset>(0);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return null;
        }

        await scope.Transaction.CommitAsync(cancellationToken);

        return signature with { SignedAt = insertedSignedAt };
    }

    /// <summary>
    /// The one signature for (tenantId, noteId), or null if the note has not been signed yet
    /// under this tenant. Tenant isolation comes from the tenant_isolation RLS policy (via
    /// <see cref="NpgsqlDataSourceTenantExtensions.OpenTenantScopedTransactionAsync"/>), not
    /// from a WHERE tenant_id clause here -- same convention as PatientRecordStore.ListAsync.
    /// </summary>
    public async Task<NoteSignature?> FindAsync(Guid tenantId, Guid noteId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = """
            SELECT tenant_id, note_id, revisao, signature, signed_at
            FROM note_signatures
            WHERE note_id = @noteId
            """;
        selectCommand.Parameters.AddWithValue("noteId", noteId);

        NoteSignature? result = null;
        await using (var reader = await selectCommand.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                result = new NoteSignature(
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    reader.GetInt32(2),
                    (byte[])reader[3],
                    reader.GetFieldValue<DateTimeOffset>(4));
            }
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return result;
    }
}
