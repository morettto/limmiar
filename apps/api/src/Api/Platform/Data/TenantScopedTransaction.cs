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

    public NpgsqlCommand CreateCommand(string sql)
    {
        var command = Connection.CreateCommand();
        command.Transaction = Transaction;
        command.CommandText = sql;
        return command;
    }

    public async Task<T?> QuerySingleAsync<T>(
        string sql,
        Func<NpgsqlDataReader, T> map,
        CancellationToken cancellationToken,
        Action<NpgsqlCommand>? configure = null)
        where T : class
    {
        await using var command = CreateCommand(sql);
        configure?.Invoke(command);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? map(reader) : null;
    }

    public async Task<IReadOnlyList<T>> QueryListAsync<T>(
        string sql,
        Func<NpgsqlDataReader, T> map,
        CancellationToken cancellationToken,
        Action<NpgsqlCommand>? configure = null)
    {
        await using var command = CreateCommand(sql);
        configure?.Invoke(command);
        var rows = new List<T>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(map(reader));
        }
        return rows;
    }

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
    /// transaction's tenant_isolation RLS policy. Thin wrapper over the <c>params</c> overload
    /// below -- the single place this repo issues a <c>set_config</c> call, so every RLS-scoped
    /// store method gets it by construction instead of re-typing it.
    /// </summary>
    public static Task<TenantScopedTransaction> OpenTenantScopedTransactionAsync(
        this NpgsqlDataSource dataSource, Guid tenantId, CancellationToken cancellationToken) =>
        dataSource.OpenTenantScopedTransactionAsync(cancellationToken, ("app.tenant_id", tenantId.ToString()));

    /// <summary>
    /// Opens a connection, begins a transaction, and sets every given GUC on it via
    /// <c>set_config(..., true)</c> -- the arbitrary-GUC shape needed by lookups that key on
    /// something other than <c>app.tenant_id</c> (<c>app.account_email</c>, <c>app.staff_review</c>,
    /// <c>app.invite_code</c>), so those store methods share this one connection+transaction+
    /// set_config primitive too instead of repeating it inline.
    /// </summary>
    public static async Task<TenantScopedTransaction> OpenTenantScopedTransactionAsync(
        this NpgsqlDataSource dataSource, CancellationToken cancellationToken, params (string Name, string Value)[] gucs)
    {
        var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var transaction = await connection.BeginTransactionAsync(cancellationToken);

        foreach (var (name, value) in gucs)
        {
            await using var setConfigCommand = connection.CreateCommand();
            setConfigCommand.Transaction = transaction;
            setConfigCommand.CommandText = "SELECT set_config(@name, @value, true)";
            setConfigCommand.Parameters.AddWithValue("name", name);
            setConfigCommand.Parameters.AddWithValue("value", value);
            await setConfigCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        return new TenantScopedTransaction { Connection = connection, Transaction = transaction };
    }
}
