using Api.Data;
using Npgsql;

namespace Api.Billing;

/// <summary>Uma linha de <c>booking_payments</c>: o efeito idempotente de uma tentativa de reserva
/// (ADR-S12-01 §5). <see cref="SessionId"/> nulo = a tentativa ainda não venceu slot nenhum.
/// Sem <c>CheckoutId</c>: correlaciona-se por parâmetro, nunca se lê daqui.</summary>
public sealed record BookingEffect(
    string ExternalId,
    Guid TenantId,
    Guid? SessionId,
    string CheckoutUrl,
    PaymentStatus Status,
    int Amount,
    string Name,
    string Contact);

/// <summary>Fronteira store→service (ADR-0011): o efeito lido mais se foi esta chamada que o
/// criou, num record nomeado, nunca tuplo.</summary>
public sealed record ClaimedEffect(BookingEffect Effect, bool IsDuplicate);

public interface IBookingPaymentStore
{
    Task<ClaimedEffect> ClaimEffectAsync(BookingEffect effect, CancellationToken cancellationToken);

    Task SetCheckoutAsync(
        string externalId, Guid tenantId, string checkoutId, string checkoutUrl,
        PaymentStatus status, int amount, CancellationToken cancellationToken);

    Task SetSessionAsync(string externalId, Guid tenantId, Guid sessionId, CancellationToken cancellationToken);

    Task MarkRefundedAsync(string externalId, Guid tenantId, CancellationToken cancellationToken);

    Task ConfirmPaymentAsync(string checkoutId, PaymentStatus status, int amount, CancellationToken cancellationToken);
}

/// <summary>Escritas sempre sob transação com tenant (RLS <c>tenant_isolation</c>); a leitura do
/// webhook com GUC próprio chega na fatia 4.</summary>
public sealed class BookingPaymentStore(NpgsqlDataSource dataSource) : IBookingPaymentStore
{
    /// <summary>Reclama o efeito exatamente uma vez: <c>ON CONFLICT DO UPDATE</c> devolve sempre
    /// uma linha e <c>(xmax = 0)</c> diz quem inseriu -- sem janela SELECT→INSERT. O SET é
    /// auto-atribuição de <c>status</c> (coluna já no GRANT da 0010).</summary>
    public async Task<ClaimedEffect> ClaimEffectAsync(BookingEffect effect, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(effect.TenantId, cancellationToken);

        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = """
            INSERT INTO booking_payments (external_id, tenant_id, session_id, checkout_id, checkout_url, status, amount, name, contact)
            VALUES (@externalId, @tenantId, NULL, '', '', @status, @amount, @name, @contact)
            ON CONFLICT (external_id) DO UPDATE SET status = booking_payments.status
            RETURNING session_id, checkout_url, status, amount, name, contact, (xmax = 0) AS inserted
            """;
        command.Parameters.AddWithValue("externalId", effect.ExternalId);
        command.Parameters.AddWithValue("tenantId", effect.TenantId);
        command.Parameters.AddWithValue("status", (int)effect.Status);
        command.Parameters.AddWithValue("amount", effect.Amount);
        command.Parameters.AddWithValue("name", effect.Name);
        command.Parameters.AddWithValue("contact", effect.Contact);

        ClaimedEffect claimed;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            claimed = new ClaimedEffect(ReadEffect(reader, effect), !reader.GetBoolean(6));
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return claimed;
    }

    public async Task SetCheckoutAsync(
        string externalId, Guid tenantId, string checkoutId, string checkoutUrl,
        PaymentStatus status, int amount, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = """
            UPDATE booking_payments
            SET checkout_id = @checkoutId, checkout_url = @checkoutUrl, status = @status, amount = @amount
            WHERE external_id = @externalId
            """;
        command.Parameters.AddWithValue("externalId", externalId);
        command.Parameters.AddWithValue("checkoutId", checkoutId);
        command.Parameters.AddWithValue("checkoutUrl", checkoutUrl);
        command.Parameters.AddWithValue("status", (int)status);
        command.Parameters.AddWithValue("amount", amount);
        await command.ExecuteNonQueryAsync(cancellationToken);

        await scope.Transaction.CommitAsync(cancellationToken);
    }

    public async Task SetSessionAsync(string externalId, Guid tenantId, Guid sessionId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = "UPDATE booking_payments SET session_id = @sessionId WHERE external_id = @externalId";
        command.Parameters.AddWithValue("externalId", externalId);
        command.Parameters.AddWithValue("sessionId", sessionId);
        await command.ExecuteNonQueryAsync(cancellationToken);

        await scope.Transaction.CommitAsync(cancellationToken);
    }

    public async Task MarkRefundedAsync(string externalId, Guid tenantId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = "UPDATE booking_payments SET status = @refunded WHERE external_id = @externalId";
        command.Parameters.AddWithValue("externalId", externalId);
        command.Parameters.AddWithValue("refunded", (int)PaymentStatus.Refunded);
        await command.ExecuteNonQueryAsync(cancellationToken);

        await scope.Transaction.CommitAsync(cancellationToken);
    }

    /// <summary>Confirmação do webhook: passo 1 resolve o tenant pelo checkout (política
    /// <c>payment_lookup</c>, sem tenant); passo 2 escreve sob o primitivo com tenant. O
    /// <c>AND status = Pending</c> torna a reentrega no-op e nunca rebaixa um reembolso.</summary>
    public async Task ConfirmPaymentAsync(string checkoutId, PaymentStatus status, int amount, CancellationToken cancellationToken)
    {
        Guid? tenantId;
        await using (var connection = await dataSource.OpenConnectionAsync(cancellationToken))
        {
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

            await using (var setCommand = connection.CreateCommand())
            {
                setCommand.Transaction = transaction;
                setCommand.CommandText = "SELECT set_config('app.payment_checkout', @checkoutId, true)";
                setCommand.Parameters.AddWithValue("checkoutId", checkoutId);
                await setCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var selectCommand = connection.CreateCommand())
            {
                selectCommand.Transaction = transaction;
                selectCommand.CommandText = "SELECT tenant_id FROM booking_payments WHERE checkout_id = @checkoutId";
                selectCommand.Parameters.AddWithValue("checkoutId", checkoutId);
                await using var reader = await selectCommand.ExecuteReaderAsync(cancellationToken);
                tenantId = await reader.ReadAsync(cancellationToken) ? reader.GetGuid(0) : null;
            }

            await transaction.CommitAsync(cancellationToken);
        }

        if (tenantId is null)
        {
            return;
        }

        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId.Value, cancellationToken);
        await using var updateCommand = scope.Connection.CreateCommand();
        updateCommand.Transaction = scope.Transaction;
        updateCommand.CommandText = """
            UPDATE booking_payments SET status = @status, amount = @amount
            WHERE checkout_id = @checkoutId AND status = @pending
            """;
        updateCommand.Parameters.AddWithValue("checkoutId", checkoutId);
        updateCommand.Parameters.AddWithValue("status", (int)status);
        updateCommand.Parameters.AddWithValue("amount", amount);
        updateCommand.Parameters.AddWithValue("pending", (int)PaymentStatus.Pending);
        await updateCommand.ExecuteNonQueryAsync(cancellationToken);

        await scope.Transaction.CommitAsync(cancellationToken);
    }

    private static BookingEffect ReadEffect(NpgsqlDataReader reader, BookingEffect claimed) => new(
        claimed.ExternalId,
        claimed.TenantId,
        reader.IsDBNull(0) ? null : reader.GetGuid(0),
        reader.GetString(1),
        (PaymentStatus)reader.GetInt32(2),
        reader.GetInt32(3),
        reader.GetString(4),
        reader.GetString(5));
}
