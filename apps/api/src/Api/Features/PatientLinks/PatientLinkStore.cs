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
/// Convites e vínculos em Postgres desde S11-03, com GUCs transacionais para o resgate e
/// desvinculação soft para preservar o histórico. Envelopes e preferências pertencem aos
/// stores especializados <see cref="SharedItemStore"/> e <see cref="SharingPreferencesStore"/>.
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

    internal NpgsqlDataSource DataSource => dataSource;

    /// <summary>Row inserted with <c>professional_account_id = me</c> (S11-03 fatia 9, migration 0012) -- the FK to accounts means an invite for an unknown professional account id is now rejected by the database, not just unreachable through the API.</summary>
    public async Task<LinkInvite> CreateInviteAsync(Guid professionalAccountId, Guid patientId, CancellationToken cancellationToken)
    {
        var code = RandomNumberGenerator.GetString(CodeAlphabet, CodeLength);
        var expiresAt = _clock() + InviteLifetime;

        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(professionalAccountId, cancellationToken);

        await using var insertCommand = scope.CreateCommand();
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

        var links = await scope.QueryListAsync("""
            SELECT professional_account_id, patient_account_id, patient_id, linked_at
            FROM patient_links
            WHERE (professional_account_id = @accountId OR patient_account_id = @accountId) AND unlinked_at IS NULL
            ORDER BY linked_at
            """, reader => new PatientLink(reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetFieldValue<DateTimeOffset>(3)),
            cancellationToken, command => command.Parameters.AddWithValue("accountId", accountId));

        await scope.Transaction.CommitAsync(cancellationToken);
        return links;
    }

    public async Task<IReadOnlyList<PatientLinkWithPeerKey>> ListForWithPeerKeyAsync(Guid accountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);
        await using var command = scope.CreateCommand();
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
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                result.Add(new PatientLinkWithPeerKey(
                    new PatientLink(reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetFieldValue<DateTimeOffset>(3)),
                    reader.IsDBNull(4) ? null : reader.GetFieldValue<byte[]>(4)));
            }
        }
        await scope.Transaction.CommitAsync(cancellationToken);
        return result;
    }

    public async Task<Result<PatientLinkWithPeerKey, RedeemFailure>> RedeemWithPeerKeyAsync(string code, Guid patientAccountId, CancellationToken cancellationToken)
    {
        var redeemed = await RedeemAsync(code, patientAccountId, cancellationToken);
        if (!redeemed.TryGetValue(out var link))
        {
            return redeemed.FailureReason;
        }

        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(patientAccountId, cancellationToken);
        await using var command = scope.CreateCommand();
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
    }

    /// <summary>Either party may unlink. Soft (<c>unlinked_at = now</c>, S11-03 fatia 9) -- the row survives for the fatia 10 received-shares history, only the two partial unique indexes free up for a new invite. False if no ACTIVE link exists between the two accounts.</summary>
    public async Task<bool> UnlinkAsync(Guid accountId, Guid peerAccountId, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(accountId, cancellationToken);

        await using var updateCommand = scope.CreateCommand();
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

}
