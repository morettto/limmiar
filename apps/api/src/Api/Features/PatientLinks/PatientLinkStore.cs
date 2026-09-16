using System.Security.Cryptography;
using Api.Data;
using Api.Platform;
using Npgsql;

namespace Api.PatientLinks;

public enum RedeemFailure
{
    AccountNotFound,
    NotAPatient,
    InviteNotFound,

    AlreadyLinked,
}

public sealed record PatientLinkWithPeerKey(PatientLink Link, byte[]? PeerPublicKey);

/// <summary>
/// Convites, vínculos, envelopes partilhados e preferências de compartilhamento, todos em
/// Postgres desde S11-03 (fatia 8: preferências; fatia 9: convites e vínculos, GUC
/// <c>app.invite_code</c> para o resgate, <c>unlinked_at</c> soft para desvincular; fatia 10:
/// envelopes em <c>shared_items</c> e <see cref="ListReceivedSharesAsync"/>).
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

    // ponytail: sem paginação em ListReceivedSharesAsync -- teto = memória do processo e o
    // tamanho da resposta HTTP (abordagem (e), E1). Upgrade: paginar por patient_account_id se
    // uma profissional acumular muitas pacientes ao longo do tempo.

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
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(
            cancellationToken, ("app.invite_code", code), ("app.tenant_id", patientAccountId.ToString()));
        var connection = scope.Connection;
        var transaction = scope.Transaction;

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

    public async Task<IReadOnlyList<PatientLinkWithPeerKey>> ListForWithPeerKeyAsync(Guid accountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);
        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = """
            SELECT l.professional_account_id, l.patient_account_id, l.patient_id, l.linked_at, kp.public_key
            FROM patient_links l
            LEFT JOIN account_key_pairs_public kp ON kp.account_id =
                CASE WHEN l.professional_account_id = @accountId THEN l.patient_account_id ELSE l.professional_account_id END
            WHERE (l.professional_account_id = @accountId OR l.patient_account_id = @accountId) AND l.unlinked_at IS NULL
            ORDER BY l.linked_at
            """;
        command.Parameters.AddWithValue("accountId", accountId);
        var result = new List<PatientLinkWithPeerKey>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new PatientLinkWithPeerKey(
                new PatientLink(reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetFieldValue<DateTimeOffset>(3)),
                reader.IsDBNull(4) ? null : reader.GetFieldValue<byte[]>(4)));
        }
        await scope.Transaction.CommitAsync(cancellationToken);
        return result;
    }

    public async Task<Result<PatientLinkWithPeerKey, RedeemFailure>> RedeemWithPeerKeyAsync(string code, Guid patientAccountId, CancellationToken cancellationToken)
    {
        var redeemed = await RedeemAsync(code, patientAccountId, cancellationToken);
        return await redeemed.Match<Task<Result<PatientLinkWithPeerKey, RedeemFailure>>>(
            async link =>
            {
                await using var scope = await dataSource.OpenTenantScopedTransactionAsync(patientAccountId, cancellationToken);
                await using var command = scope.Connection.CreateCommand();
                command.Transaction = scope.Transaction;
                command.CommandText = """
                    SELECT kp.public_key FROM patient_links l
                    LEFT JOIN account_key_pairs_public kp ON kp.account_id = l.professional_account_id
                    WHERE l.professional_account_id = @professionalAccountId AND l.patient_account_id = @patientAccountId
                    ORDER BY l.linked_at DESC LIMIT 1
                    """;
                command.Parameters.AddWithValue("professionalAccountId", link.ProfessionalAccountId);
                command.Parameters.AddWithValue("patientAccountId", patientAccountId);
                var key = await command.ExecuteScalarAsync(cancellationToken) as byte[];
                await scope.Transaction.CommitAsync(cancellationToken);
                return new PatientLinkWithPeerKey(link, key);
            },
            failure => Task.FromResult<Result<PatientLinkWithPeerKey, RedeemFailure>>(failure));
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

    /// <summary>
    /// False if no ACTIVE link exists between the two accounts in this direction -- share only
    /// travels along a real (patient, professional) link. Unlink does not remove what was already
    /// appended here (README invariant: revoking is a preferences-blob change, never a delete of
    /// past envelopes). S11-03 fatia 10: the link check and the insert are now one Postgres
    /// statement (<c>INSERT ... SELECT ... WHERE EXISTS (...) FOR SHARE</c>), so a concurrent
    /// <see cref="UnlinkAsync"/> can no longer interleave between "checked" and "appended" -- the
    /// <c>FOR SHARE</c> row lock on the matching <c>patient_links</c> row forces the two
    /// transactions to serialize: whichever commits first decides the outcome for the other
    /// (proven by PatientLinkStoreTests.ShareAsync_ConcurrentWithUnlink_NeverInsertsAnEnvelopeAfterUnlinkedAt).
    /// </summary>
    public async Task<bool> ShareAsync(Guid patientAccountId, Guid professionalAccountId, byte[] ciphertext, CancellationToken cancellationToken)
    {
        var sharedAt = _clock();
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(patientAccountId, cancellationToken);

        await using var insertCommand = scope.Connection.CreateCommand();
        insertCommand.Transaction = scope.Transaction;
        insertCommand.CommandText = """
            INSERT INTO shared_items (patient_account_id, professional_account_id, shared_at, ciphertext)
            SELECT @patientAccountId, @professionalAccountId, @sharedAt, @ciphertext
            WHERE EXISTS (
                SELECT 1 FROM patient_links
                WHERE patient_account_id = @patientAccountId
                  AND professional_account_id = @professionalAccountId
                  AND unlinked_at IS NULL
                FOR SHARE
            )
            RETURNING id
            """;
        insertCommand.Parameters.AddWithValue("patientAccountId", patientAccountId);
        insertCommand.Parameters.AddWithValue("professionalAccountId", professionalAccountId);
        insertCommand.Parameters.AddWithValue("sharedAt", sharedAt);
        insertCommand.Parameters.AddWithValue("ciphertext", ciphertext);

        var insertedId = await insertCommand.ExecuteScalarAsync(cancellationToken);
        await scope.Transaction.CommitAsync(cancellationToken);
        return insertedId is not null;
    }

    /// <summary>Null if no ACTIVE link exists between the two accounts in this direction; otherwise the items in arrival order, possibly empty. Re-linking after Unlink surfaces whatever was shared before -- the list is keyed by account pair, not by link instance. The link check and the read are two statements (unlike <see cref="ShareAsync"/>): a GET has nothing to race atomically against, it only needs the same 404-after-unlink answer <see cref="SharedItemEndpoints"/> already gives.</summary>
    public async Task<IReadOnlyList<SharedItem>?> ListSharedAsync(Guid professionalAccountId, Guid patientAccountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(professionalAccountId, cancellationToken);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = """
            WITH link_state AS (
                SELECT EXISTS (
                    SELECT 1 FROM patient_links
                    WHERE patient_account_id = @patientAccountId
                      AND professional_account_id = @professionalAccountId
                      AND unlinked_at IS NULL
                ) AS is_linked
            )
            SELECT link_state.is_linked, si.shared_at, si.ciphertext
            FROM link_state
            LEFT JOIN shared_items si ON si.patient_account_id = @patientAccountId
                AND si.professional_account_id = @professionalAccountId
            ORDER BY si.id
            """;
        selectCommand.Parameters.AddWithValue("patientAccountId", patientAccountId);
        selectCommand.Parameters.AddWithValue("professionalAccountId", professionalAccountId);

        var items = new List<SharedItem>();
        var linked = false;
        await using (var reader = await selectCommand.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                if (!reader.GetBoolean(0))
                {
                    break;
                }
                linked = true;
                if (!reader.IsDBNull(1))
                {
                    items.Add(new SharedItem(professionalAccountId, patientAccountId, reader.GetFieldValue<DateTimeOffset>(1), reader.GetFieldValue<byte[]>(2)));
                }
            }
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return linked ? items : null;
    }

    /// <summary>
    /// Every patient this professional was ever linked to (S11-03 fatia 10, abordagem (e) E1) --
    /// one row per <c>patient_account_id</c>, the most recent <c>patient_links</c> row for that
    /// pair (<c>DISTINCT ON</c>), whether that link is still active or was soft-unlinked. Every
    /// envelope ever shared along the pair is attached regardless of the link's current state --
    /// this is the read <c>EspelhoP6</c> uses instead of <c>GET links</c> + <c>GET shared-items</c>
    /// per link, precisely because those two 404 after unlink and this must not. Never null, never
    /// throws for "no links yet" -- an empty list is a valid answer for a brand new professional.
    /// </summary>
    public async Task<IReadOnlyList<ReceivedShare>> ListReceivedSharesAsync(Guid professionalAccountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(professionalAccountId, cancellationToken);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = """
            WITH latest_links AS (
                SELECT DISTINCT ON (patient_account_id) patient_account_id, patient_id, linked_at, unlinked_at
                FROM patient_links
                WHERE professional_account_id = @professionalAccountId
                ORDER BY patient_account_id, linked_at DESC
            )
            SELECT ll.patient_account_id, ll.patient_id, ll.linked_at, ll.unlinked_at, kp.public_key,
                   si.shared_at, si.ciphertext
            FROM latest_links ll
            LEFT JOIN account_key_pairs kp ON kp.account_id = ll.patient_account_id
            LEFT JOIN shared_items si ON si.patient_account_id = ll.patient_account_id
                                      AND si.professional_account_id = @professionalAccountId
            ORDER BY ll.linked_at, si.id
            """;
        selectCommand.Parameters.AddWithValue("professionalAccountId", professionalAccountId);

        var order = new List<Guid>();
        var byPatient = new Dictionary<Guid, (Guid PatientId, DateTimeOffset LinkedAt, DateTimeOffset? UnlinkedAt, byte[]? PeerPublicKey, List<SharedItem> Items)>();

        await using (var reader = await selectCommand.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                var patientAccountId = reader.GetGuid(0);
                if (!byPatient.TryGetValue(patientAccountId, out var entry))
                {
                    entry = (
                        reader.GetGuid(1),
                        reader.GetFieldValue<DateTimeOffset>(2),
                        reader.IsDBNull(3) ? null : reader.GetFieldValue<DateTimeOffset>(3),
                        reader.IsDBNull(4) ? null : reader.GetFieldValue<byte[]>(4),
                        []);
                    byPatient[patientAccountId] = entry;
                    order.Add(patientAccountId);
                }

                if (!reader.IsDBNull(5))
                {
                    entry.Items.Add(new SharedItem(professionalAccountId, patientAccountId, reader.GetFieldValue<DateTimeOffset>(5), reader.GetFieldValue<byte[]>(6)));
                }
            }
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return order.Select(patientAccountId =>
        {
            var entry = byPatient[patientAccountId];
            return new ReceivedShare(patientAccountId, entry.PatientId, entry.LinkedAt, entry.UnlinkedAt, entry.PeerPublicKey, entry.Items);
        }).ToArray();
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
    /// version did under its lock. A conflict is represented by a null result.
    /// </summary>
    public async Task<SharingPreferences?> PutPreferencesAsync(
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
            await scope.Transaction.CommitAsync(cancellationToken);
            return null;
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return updated;
    }

    private static SharingPreferences ReadPreferences(NpgsqlDataReader reader) =>
        new(reader.GetInt64(0), reader.GetFieldValue<byte[]>(1), reader.GetFieldValue<byte[]>(2));

}
