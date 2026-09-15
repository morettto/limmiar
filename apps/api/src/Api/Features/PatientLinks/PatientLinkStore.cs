using System.Security.Cryptography;
using Api.Data;
using Api.Platform;
using Npgsql;

namespace Api.PatientLinks;

public enum RedeemFailure
{
    InviteNotFound,

    AlreadyLinked,
}

/// <summary>
/// Convites, vínculos e preferências de compartilhamento em Postgres desde S11-03 (fatia 8:
/// preferências; fatia 9: convites e vínculos, GUC <c>app.invite_code</c> para o resgate,
/// <c>unlinked_at</c> soft para desvincular). Envelopes partilhados (<see cref="ShareAsync"/>/
/// <see cref="ListSharedAsync"/>) continuam em memória até à fatia 10 (lote 3, junto da rota
/// <c>received-shares</c>) -- ver <c>.harness/S11-03-forma.md</c> §5.5.
/// </summary>
public sealed class PatientLinkStore(NpgsqlDataSource dataSource, Func<DateTimeOffset>? clock = null)
{
    // Crockford's Base32: exclui I/L/O/U para não confundir com 1/0/V -- 32 símbolos, 12
    // caracteres = 60 bits de entropia, inadivinhável mesmo por tentativa em massa dentro do
    // TTL de 7 dias.
    private const string CodeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private const int CodeLength = 12;

    public static readonly TimeSpan InviteLifetime = TimeSpan.FromDays(7);

    private readonly Func<DateTimeOffset> _clock = clock ?? (() => DateTimeOffset.UtcNow);

    // ponytail: sem teto de itens por vínculo, além da memória do processo. Upgrade: tabela
    // shared_items (já criada pela migração 0012) fica pronta para a fatia 10 usar.
    // ponytail: o par (check IsLinkedAsync + append) já não é atômico com Unlink -- entre o
    // SELECT em Postgres e a escrita aqui, um Unlink concorrente pode intercalar-se (janela
    // estreita, sem teste que a exercite). Aceitável até a fatia 10 mover os envelopes para
    // shared_items: a partir daí o INSERT/SELECT corre na mesma transação Postgres do vínculo.
    private readonly Lock _sharedItemsLock = new();
    private readonly Dictionary<(Guid PatientAccountId, Guid ProfessionalAccountId), List<SharedItem>> _sharedItems = new();

    /// <summary>Row inserted with <c>professional_account_id = me</c> (S11-03 fatia 9, migration 0012) -- the FK to accounts means an invite for an unknown professional account id is now rejected by the database, not just unreachable through the API.</summary>
    public async Task<LinkInvite> CreateInviteAsync(Guid professionalAccountId, Guid patientId, CancellationToken cancellationToken)
    {
        var code = RandomNumberGenerator.GetString(CodeAlphabet, CodeLength);
        var expiresAt = _clock() + InviteLifetime;

        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(professionalAccountId, cancellationToken);

        await using var insertCommand = scope.Connection.CreateCommand();
        insertCommand.Transaction = scope.Transaction;
        insertCommand.CommandText = """
            INSERT INTO patient_link_invites (code, professional_account_id, patient_id, expires_at)
            VALUES (@code, @professionalAccountId, @patientId, @expiresAt)
            """;
        insertCommand.Parameters.AddWithValue("code", code);
        insertCommand.Parameters.AddWithValue("professionalAccountId", professionalAccountId);
        insertCommand.Parameters.AddWithValue("patientId", patientId);
        insertCommand.Parameters.AddWithValue("expiresAt", expiresAt);
        await insertCommand.ExecuteNonQueryAsync(cancellationToken);

        await scope.Transaction.CommitAsync(cancellationToken);
        return new LinkInvite(code, professionalAccountId, patientId, expiresAt);
    }

    /// <summary>
    /// Invalid, expired, or already-redeemed code all collapse into <see cref="RedeemFailure.InviteNotFound"/>
    /// -- a caller cannot tell "never existed" from "already used" apart. GUC <c>app.invite_code</c>
    /// (abordagem (d)) makes the one invite row visible to a caller who has no session on the
    /// issuing professional's account, only the code. The invite is deleted (<c>DELETE ...
    /// RETURNING</c>) in the same transaction as the <c>patient_links</c> insert: two concurrent
    /// redeems of the same code race the row lock on that single invite row, so only the first
    /// DELETE finds it -- the rest see zero rows and report InviteNotFound before ever attempting
    /// an insert (proven by PatientLinkStoreTests.RedeemAsync_TwoConcurrentAttemptsOnSameCode_ExactlyOneWins).
    /// A second invite for an already-linked pair instead loses the race on
    /// patient_links_active_account_pair_uq/patient_links_active_patient_id_uq (23505) and reports
    /// AlreadyLinked.
    /// </summary>
    public async Task<Result<PatientLink, RedeemFailure>> RedeemAsync(string code, Guid patientAccountId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await SetConfigAsync(connection, transaction, "app.invite_code", code, cancellationToken);
        await SetConfigAsync(connection, transaction, "app.tenant_id", patientAccountId.ToString(), cancellationToken);

        Guid professionalAccountId;
        Guid patientId;
        await using (var deleteCommand = connection.CreateCommand())
        {
            deleteCommand.Transaction = transaction;
            deleteCommand.CommandText = """
                DELETE FROM patient_link_invites
                WHERE code = @code AND expires_at > @now
                RETURNING professional_account_id, patient_id
                """;
            deleteCommand.Parameters.AddWithValue("code", code);
            deleteCommand.Parameters.AddWithValue("now", _clock());

            await using var reader = await deleteCommand.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return RedeemFailure.InviteNotFound;
            }

            professionalAccountId = reader.GetGuid(0);
            patientId = reader.GetGuid(1);
        }

        var linkedAt = _clock();
        await using (var insertCommand = connection.CreateCommand())
        {
            insertCommand.Transaction = transaction;
            insertCommand.CommandText = """
                INSERT INTO patient_links (professional_account_id, patient_account_id, patient_id, linked_at)
                VALUES (@professionalAccountId, @patientAccountId, @patientId, @linkedAt)
                """;
            insertCommand.Parameters.AddWithValue("professionalAccountId", professionalAccountId);
            insertCommand.Parameters.AddWithValue("patientAccountId", patientAccountId);
            insertCommand.Parameters.AddWithValue("patientId", patientId);
            insertCommand.Parameters.AddWithValue("linkedAt", linkedAt);

            try
            {
                await insertCommand.ExecuteNonQueryAsync(cancellationToken);
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return RedeemFailure.AlreadyLinked;
            }
        }

        await transaction.CommitAsync(cancellationToken);
        return new PatientLink(professionalAccountId, patientAccountId, patientId, linkedAt);
    }

    /// <summary>Every active link where <paramref name="accountId"/> is either side -- the professional or the patient. Soft-unlinked rows (<c>unlinked_at</c> set) never appear here (S11-03 fatia 9); <c>GET links</c> keeps its 404-after-unlink behavior downstream because there is simply no row to view.</summary>
    public async Task<IReadOnlyList<PatientLink>> ListForAsync(Guid accountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = """
            SELECT professional_account_id, patient_account_id, patient_id, linked_at
            FROM patient_links
            WHERE (professional_account_id = @accountId OR patient_account_id = @accountId) AND unlinked_at IS NULL
            ORDER BY linked_at
            """;
        selectCommand.Parameters.AddWithValue("accountId", accountId);

        var links = new List<PatientLink>();
        await using (var reader = await selectCommand.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                links.Add(new PatientLink(reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetFieldValue<DateTimeOffset>(3)));
            }
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return links;
    }

    /// <summary>Either party may unlink. Soft (<c>unlinked_at = now</c>, S11-03 fatia 9) -- the row survives for the fatia 10 received-shares history, only the two partial unique indexes free up for a new invite. False if no ACTIVE link exists between the two accounts.</summary>
    public async Task<bool> UnlinkAsync(Guid accountId, Guid peerAccountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);

        await using var updateCommand = scope.Connection.CreateCommand();
        updateCommand.Transaction = scope.Transaction;
        updateCommand.CommandText = """
            UPDATE patient_links
            SET unlinked_at = @unlinkedAt
            WHERE unlinked_at IS NULL
              AND ((professional_account_id = @accountId AND patient_account_id = @peerAccountId)
                OR (professional_account_id = @peerAccountId AND patient_account_id = @accountId))
            """;
        updateCommand.Parameters.AddWithValue("unlinkedAt", _clock());
        updateCommand.Parameters.AddWithValue("accountId", accountId);
        updateCommand.Parameters.AddWithValue("peerAccountId", peerAccountId);

        var affectedRows = await updateCommand.ExecuteNonQueryAsync(cancellationToken);
        await scope.Transaction.CommitAsync(cancellationToken);
        return affectedRows > 0;
    }

    /// <summary>False if no ACTIVE link exists between the two accounts in this direction -- share only travels along a real (patient, professional) link. Unlink does not remove what was already appended here (README invariant: revoking is a preferences-blob change, never a delete of past envelopes). The link check itself is Postgres (fatia 9); the envelope list is still the in-memory dictionary (fatia 10 moves it to shared_items).</summary>
    public async Task<bool> ShareAsync(Guid patientAccountId, Guid professionalAccountId, byte[] ciphertext, CancellationToken cancellationToken)
    {
        if (!await IsLinkedAsync(patientAccountId, professionalAccountId, patientAccountId, cancellationToken))
        {
            return false;
        }

        lock (_sharedItemsLock)
        {
            var key = (patientAccountId, professionalAccountId);
            if (!_sharedItems.TryGetValue(key, out var items))
            {
                items = [];
                _sharedItems[key] = items;
            }

            items.Add(new SharedItem(professionalAccountId, patientAccountId, _clock(), ciphertext));
        }

        return true;
    }

    /// <summary>Null if no ACTIVE link exists between the two accounts in this direction; otherwise the items in arrival order, possibly empty. Re-linking after Unlink surfaces whatever was shared before -- the list is keyed by account pair, not by link instance.</summary>
    public async Task<IReadOnlyList<SharedItem>?> ListSharedAsync(Guid professionalAccountId, Guid patientAccountId, CancellationToken cancellationToken)
    {
        if (!await IsLinkedAsync(patientAccountId, professionalAccountId, professionalAccountId, cancellationToken))
        {
            return null;
        }

        lock (_sharedItemsLock)
        {
            return _sharedItems.TryGetValue((patientAccountId, professionalAccountId), out var items)
                ? items.ToArray()
                : [];
        }
    }

    private static async Task SetConfigAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, string setting, string value, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT set_config(@setting, @value, true)";
        command.Parameters.AddWithValue("setting", setting);
        command.Parameters.AddWithValue("value", value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>Null if the account never saved sharing preferences (S11-03 fatia 8, Postgres).</summary>
    public async Task<SharingPreferences?> GetPreferencesAsync(Guid accountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = "SELECT version, wrapped_dek, ciphertext FROM sharing_preferences WHERE account_id = @accountId";
        selectCommand.Parameters.AddWithValue("accountId", accountId);

        SharingPreferences? preferences = null;
        await using (var reader = await selectCommand.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                preferences = ReadPreferences(reader);
            }
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return preferences;
    }

    /// <summary>
    /// Optimistic concurrency as a database guarantee, not an in-process lock (S11-03 fatia 8):
    /// <paramref name="expectedVersion"/> 0 goes through <c>INSERT ... ON CONFLICT DO NOTHING</c>
    /// (the row does not exist yet, so a unique-violation race resolves to "someone else already
    /// created it"); any other value goes through <c>UPDATE ... WHERE version = @expected</c> (the
    /// row exists, and a concurrent winner already advanced it past what this caller expected).
    /// Either shape returns zero rows on a lost race -- the caller then reads the current version
    /// inside the same transaction and reports it as the failure, exactly like the in-memory
    /// version did under its lock. Proven under concurrent callers racing the same
    /// expectedVersion by PatientLinkStoreTests.PutPreferencesAsync_ConcurrentSameExpectedVersion_ExactlyOneWins.
    /// </summary>
    public async Task<Result<SharingPreferences, long>> PutPreferencesAsync(
        Guid accountId, long expectedVersion, byte[] wrappedDek, byte[] ciphertext, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);

        await using var upsertCommand = scope.Connection.CreateCommand();
        upsertCommand.Transaction = scope.Transaction;
        upsertCommand.Parameters.AddWithValue("accountId", accountId);
        upsertCommand.Parameters.AddWithValue("wrappedDek", wrappedDek);
        upsertCommand.Parameters.AddWithValue("ciphertext", ciphertext);

        if (expectedVersion == 0)
        {
            upsertCommand.CommandText = """
                INSERT INTO sharing_preferences (account_id, version, wrapped_dek, ciphertext)
                VALUES (@accountId, 1, @wrappedDek, @ciphertext)
                ON CONFLICT (account_id) DO NOTHING
                RETURNING version, wrapped_dek, ciphertext
                """;
        }
        else
        {
            upsertCommand.CommandText = """
                UPDATE sharing_preferences
                SET version = @newVersion, wrapped_dek = @wrappedDek, ciphertext = @ciphertext, updated_at = now()
                WHERE account_id = @accountId AND version = @expectedVersion
                RETURNING version, wrapped_dek, ciphertext
                """;
            upsertCommand.Parameters.AddWithValue("expectedVersion", expectedVersion);
            upsertCommand.Parameters.AddWithValue("newVersion", expectedVersion + 1);
        }

        SharingPreferences? updated;
        await using (var reader = await upsertCommand.ExecuteReaderAsync(cancellationToken))
        {
            updated = await reader.ReadAsync(cancellationToken) ? ReadPreferences(reader) : null;
        }

        if (updated is null)
        {
            var currentVersion = await ReadCurrentPreferencesVersionAsync(scope, accountId, cancellationToken);
            await scope.Transaction.CommitAsync(cancellationToken);
            return Result<SharingPreferences, long>.Failure(currentVersion);
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return updated;
    }

    private static async Task<long> ReadCurrentPreferencesVersionAsync(
        TenantScopedTransaction scope, Guid accountId, CancellationToken cancellationToken)
    {
        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = "SELECT version FROM sharing_preferences WHERE account_id = @accountId";
        selectCommand.Parameters.AddWithValue("accountId", accountId);

        var currentVersion = await selectCommand.ExecuteScalarAsync(cancellationToken);
        return currentVersion is long version ? version : 0;
    }

    private static SharingPreferences ReadPreferences(NpgsqlDataReader reader) =>
        new(reader.GetInt64(0), reader.GetFieldValue<byte[]>(1), reader.GetFieldValue<byte[]>(2));

    /// <summary><paramref name="tenantId"/> is whichever side is calling (accountId in the endpoint) -- the RLS policy on patient_links only shows rows where that side matches, so an unrelated caller sees zero rows regardless of the WHERE clause below.</summary>
    private async Task<bool> IsLinkedAsync(Guid patientAccountId, Guid professionalAccountId, Guid tenantId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = """
            SELECT 1 FROM patient_links
            WHERE patient_account_id = @patientAccountId AND professional_account_id = @professionalAccountId AND unlinked_at IS NULL
            """;
        selectCommand.Parameters.AddWithValue("patientAccountId", patientAccountId);
        selectCommand.Parameters.AddWithValue("professionalAccountId", professionalAccountId);

        var result = await selectCommand.ExecuteScalarAsync(cancellationToken);
        await scope.Transaction.CommitAsync(cancellationToken);
        return result is not null;
    }
}
