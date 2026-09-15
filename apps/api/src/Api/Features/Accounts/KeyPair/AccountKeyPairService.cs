using Api.Data;
using Api.Platform;
using Npgsql;

namespace Api.Accounts;

public enum PublishKeyPairFailure
{
    AccountNotFound,

    PublicKeyConflict,
}

/// <summary>
/// Publishes and reads the account's static X25519 envelope (ADR-S11-06) in its own
/// <c>account_key_pairs</c> table (S11-03, fatia 6) -- not a column on <c>accounts</c>, so
/// <see cref="IAccountStore.UpdateAsync"/>'s last-write-wins replace of the whole account row
/// (TOTP, WebAuthn, voice enrollment) can never clobber it. The public key is immutable once
/// published: a second <see cref="PublishAsync"/> with the SAME public key replaces the wrapped
/// DEK / sealed private key (serves KEK rotation via rewrap), but a DIFFERENT public key is a
/// 409 -- the first publication wins, decided by the database itself
/// (<c>INSERT ... ON CONFLICT ... WHERE public_key = EXCLUDED.public_key</c>), so two devices
/// racing to generate a pair converge on one even across machines/processes (a
/// <c>SemaphoreSlim</c> only ever serialized one process).
/// </summary>
public sealed class AccountKeyPairService(IAccountStore accounts, NpgsqlDataSource dataSource)
{
    public async Task<Result<AccountKeyPair, PublishKeyPairFailure>> PublishAsync(
        Guid accountId, AccountKeyPair pair, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return PublishKeyPairFailure.AccountNotFound;
        }

        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);

        await using var upsertCommand = scope.Connection.CreateCommand();
        upsertCommand.Transaction = scope.Transaction;
        upsertCommand.CommandText = """
            INSERT INTO account_key_pairs (account_id, public_key, wrapped_dek, sealed_private_key)
            VALUES (@accountId, @publicKey, @wrappedDek, @sealedPrivateKey)
            ON CONFLICT (account_id) DO UPDATE
                SET wrapped_dek = EXCLUDED.wrapped_dek,
                    sealed_private_key = EXCLUDED.sealed_private_key,
                    updated_at = now()
                WHERE account_key_pairs.public_key = EXCLUDED.public_key
            RETURNING public_key, wrapped_dek, sealed_private_key
            """;
        upsertCommand.Parameters.AddWithValue("accountId", accountId);
        upsertCommand.Parameters.AddWithValue("publicKey", pair.PublicKey);
        upsertCommand.Parameters.AddWithValue("wrappedDek", pair.WrappedDek);
        upsertCommand.Parameters.AddWithValue("sealedPrivateKey", pair.SealedPrivateKey);

        AccountKeyPair? stored;
        await using (var reader = await upsertCommand.ExecuteReaderAsync(cancellationToken))
        {
            // No row back means the conflicting row's public_key differs from EXCLUDED's --
            // the WHERE guard on the DO UPDATE skipped the write, so nothing to return.
            stored = await reader.ReadAsync(cancellationToken) ? ReadKeyPair(reader) : null;
        }

        if (stored is null)
        {
            return PublishKeyPairFailure.PublicKeyConflict;
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return stored;
    }

    /// <summary>Null covers both "unknown account" and "account exists but never published a key pair" -- same as VoiceEnrollmentService.GetAsync.</summary>
    public async Task<AccountKeyPair?> GetAsync(Guid accountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = "SELECT public_key, wrapped_dek, sealed_private_key FROM account_key_pairs WHERE account_id = @accountId";
        selectCommand.Parameters.AddWithValue("accountId", accountId);

        await using var reader = await selectCommand.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return ReadKeyPair(reader);
    }

    private static AccountKeyPair ReadKeyPair(NpgsqlDataReader reader) => new(
        reader.GetFieldValue<byte[]>(0), reader.GetFieldValue<byte[]>(1), reader.GetFieldValue<byte[]>(2));
}
