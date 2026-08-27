using Npgsql;

namespace Api.Data;

/// <summary>
/// An open connection + transaction with <c>app.tenant_id</c> already set via
/// <c>set_config(..., true)</c> for the tenant_isolation RLS policy -- the one primitive
/// every RLS-scoped query in this codebase must run under. Disposing rolls back if the
/// caller never called <see cref="Transaction"/>.CommitAsync(); commit explicitly on the
/// success path.
/// </summary>
public sealed class TenantScopedTransaction : IAsyncDisposable
{
    public required NpgsqlConnection Connection { get; init; }

    public required NpgsqlTransaction Transaction { get; init; }

    public async ValueTask DisposeAsync()
    {
        await Transaction.DisposeAsync();
        await Connection.DisposeAsync();
    }
}

public static class NpgsqlDataSourceTenantExtensions
{
    /// <summary>
    /// Opens a connection, begins a transaction, and sets <c>app.tenant_id</c> for that
    /// transaction's tenant_isolation RLS policy -- the single place this repo issues that
    /// <c>set_config</c> call, so every RLS-scoped store method gets it by construction
    /// instead of re-typing it.
    /// </summary>
    public static async Task<TenantScopedTransaction> OpenTenantScopedTransactionAsync(
        this NpgsqlDataSource dataSource, Guid tenantId, CancellationToken cancellationToken)
    {
        var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var setTenantCommand = connection.CreateCommand())
        {
            setTenantCommand.Transaction = transaction;
            setTenantCommand.CommandText = "SELECT set_config('app.tenant_id', @tenantId, true)";
            setTenantCommand.Parameters.AddWithValue("tenantId", tenantId.ToString());
            await setTenantCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        return new TenantScopedTransaction { Connection = connection, Transaction = transaction };
    }
}
