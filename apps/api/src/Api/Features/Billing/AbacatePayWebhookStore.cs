using Npgsql;

namespace Api.Billing;

/// <summary>
/// Postgres-backed memória de idempotência de webhooks AbacatePay (S12-01, fatia 5). Ligação
/// simples via <see cref="NpgsqlDataSource.OpenConnectionAsync"/> (molde
/// <c>HealthEndpoints.HandleGetHealthDbAsync</c>) -- NUNCA
/// <c>OpenTenantScopedTransactionAsync</c>: não existe tenant no instante do dedupe (ver
/// docs/adr/ADR-S12-01-dedupe-de-webhook-sem-rls.md).
/// </summary>
public sealed class AbacatePayWebhookStore(NpgsqlDataSource dataSource)
{
    /// <summary>
    /// Regista uma vez. <c>ON CONFLICT (event_id) DO NOTHING</c> nunca lança
    /// unique-violation na reentrega -- devolve <c>true</c> na primeira vez que
    /// <paramref name="eventId"/> é visto (a linha foi inserida), <c>false</c> numa reentrega
    /// (o INSERT foi ignorado).
    /// </summary>
    public async Task<bool> TryRecordAsync(string eventId, string eventType, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO abacatepay_webhook_events (event_id, event)
            VALUES (@eventId, @event)
            ON CONFLICT (event_id) DO NOTHING
            """;
        command.Parameters.AddWithValue("eventId", eventId);
        command.Parameters.AddWithValue("event", eventType);

        var rowsInserted = await command.ExecuteNonQueryAsync(cancellationToken);
        return rowsInserted == 1;
    }
}
