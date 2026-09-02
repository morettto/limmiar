using Api.Data;
using Npgsql;

namespace Api.Consent;

/// <summary>
/// Postgres-backed store for the append-only <c>consent_events</c> log. Single implementation,
/// no interface -- same reasoning as <c>NoteSignatureStore</c>: the RLS proof needs a real
/// Testcontainers Postgres, so there is no in-memory fake to substitute it for.
/// </summary>
public sealed class ConsentEventStore(NpgsqlDataSource dataSource)
{
    /// <summary>
    /// Appends one event -- always an INSERT, matching the design's "revoking never updates or
    /// deletes the earlier grant" invariant. <c>recorded_at</c> is not bound from
    /// <paramref name="evt"/>: the column's <c>DEFAULT now()</c> decides it (molde
    /// <c>note_signatures.signed_at</c>), so one clock -- Postgres's -- gives
    /// <see cref="ConsentState.Fold"/> a total order across concurrent writers.
    /// </summary>
    public async Task<ConsentEvent> InsertAsync(ConsentEvent evt, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(evt.TenantId, cancellationToken);

        await using var insertCommand = scope.Connection.CreateCommand();
        insertCommand.Transaction = scope.Transaction;
        insertCommand.CommandText = """
            INSERT INTO consent_events (tenant_id, patient_id, purpose, decision)
            VALUES (@tenantId, @patientId, @purpose, @decision)
            RETURNING recorded_at
            """;
        insertCommand.Parameters.AddWithValue("tenantId", evt.TenantId);
        insertCommand.Parameters.AddWithValue("patientId", evt.PatientId);
        insertCommand.Parameters.AddWithValue("purpose", (short)evt.Purpose);
        insertCommand.Parameters.AddWithValue("decision", (short)evt.Decision);

        DateTimeOffset insertedRecordedAt;
        await using (var reader = await insertCommand.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            insertedRecordedAt = reader.GetFieldValue<DateTimeOffset>(0);
        }

        await scope.Transaction.CommitAsync(cancellationToken);

        return evt with { RecordedAt = insertedRecordedAt };
    }

    /// <summary>
    /// Every event for (tenantId, patientId), oldest first -- the order
    /// <see cref="ConsentState.Fold"/> assumes. Tenant isolation comes from the
    /// tenant_isolation RLS policy (via
    /// <see cref="NpgsqlDataSourceTenantExtensions.OpenTenantScopedTransactionAsync"/>), not
    /// from a WHERE tenant_id clause here -- same convention as
    /// <c>NoteSignatureStore.FindAsync</c>.
    /// </summary>
    public async Task<IReadOnlyList<ConsentEvent>> ListAsync(Guid tenantId, Guid patientId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = """
            SELECT tenant_id, patient_id, purpose, decision, recorded_at
            FROM consent_events
            WHERE patient_id = @patientId
            ORDER BY recorded_at
            """;
        selectCommand.Parameters.AddWithValue("patientId", patientId);

        var events = new List<ConsentEvent>();
        await using (var reader = await selectCommand.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                events.Add(new ConsentEvent(
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    (ConsentPurpose)reader.GetInt16(2),
                    (ConsentDecision)reader.GetInt16(3),
                    reader.GetFieldValue<DateTimeOffset>(4)));
            }
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return events;
    }
}
