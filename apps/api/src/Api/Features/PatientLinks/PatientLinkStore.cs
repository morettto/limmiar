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
    private readonly Lock _lock = new();
    private readonly Dictionary<string, LinkInvite> _invites = new(StringComparer.Ordinal);
    private readonly List<PatientLink> _links = [];

    // ponytail: sem teto de itens por vínculo, além da memória do processo. Upgrade: tabela
    // shared_items (já criada pela migração 0012) fica pronta para a fatia 10 usar.
    private readonly Dictionary<(Guid PatientAccountId, Guid ProfessionalAccountId), List<SharedItem>> _sharedItems = new();

    public LinkInvite CreateInvite(Guid professionalAccountId, Guid patientId)
    {
        var invite = new LinkInvite(
            RandomNumberGenerator.GetString(CodeAlphabet, CodeLength),
            professionalAccountId,
            patientId,
            _clock() + InviteLifetime);

        lock (_lock)
        {
            _invites[invite.Code] = invite;
        }

        return invite;
    }

    /// <summary>
    /// Invalid, expired, or already-redeemed code all collapse into <see cref="RedeemFailure.InviteNotFound"/>
    /// -- a caller cannot tell "never existed" from "already used" apart. The invite is consumed
    /// only on success, inside the same lock as the duplicate check, so two concurrent redeems of
    /// the same code always leave exactly one winner (proven by
    /// PatientLinkStoreTests.Redeem_TwoConcurrentAttemptsOnSameCode_ExactlyOneWins).
    /// </summary>
    public Result<PatientLink, RedeemFailure> Redeem(string code, Guid patientAccountId)
    {
        lock (_lock)
        {
            if (!_invites.TryGetValue(code, out var invite) || invite.ExpiresAt <= _clock())
            {
                return RedeemFailure.InviteNotFound;
            }

            var alreadyLinked = _links.Exists(link =>
                link.ProfessionalAccountId == invite.ProfessionalAccountId &&
                (link.PatientAccountId == patientAccountId || link.PatientId == invite.PatientId));
            if (alreadyLinked)
            {
                return RedeemFailure.AlreadyLinked;
            }

            var link = new PatientLink(invite.ProfessionalAccountId, patientAccountId, invite.PatientId, _clock());
            _links.Add(link);
            _invites.Remove(code);
            return link;
        }
    }

    /// <summary>Every link where <paramref name="accountId"/> is either side -- the professional or the patient.</summary>
    public IReadOnlyList<PatientLink> ListFor(Guid accountId)
    {
        lock (_lock)
        {
            return _links.FindAll(link => link.ProfessionalAccountId == accountId || link.PatientAccountId == accountId);
        }
    }

    /// <summary>Either party may unlink. False if no link exists between the two accounts.</summary>
    public bool Unlink(Guid accountId, Guid peerAccountId)
    {
        lock (_lock)
        {
            var index = _links.FindIndex(link =>
                (link.ProfessionalAccountId == accountId && link.PatientAccountId == peerAccountId) ||
                (link.ProfessionalAccountId == peerAccountId && link.PatientAccountId == accountId));
            if (index < 0)
            {
                return false;
            }

            _links.RemoveAt(index);
            return true;
        }
    }

    /// <summary>False if no link exists between the two accounts in this direction -- share only travels along a real (patient, professional) link. Unlink does not remove what was already appended here (README invariant: revoking is a preferences-blob change, never a delete of past envelopes).</summary>
    public bool Share(Guid patientAccountId, Guid professionalAccountId, byte[] ciphertext)
    {
        lock (_lock)
        {
            if (!IsLinked(patientAccountId, professionalAccountId))
            {
                return false;
            }

            var key = (patientAccountId, professionalAccountId);
            if (!_sharedItems.TryGetValue(key, out var items))
            {
                items = [];
                _sharedItems[key] = items;
            }

            items.Add(new SharedItem(professionalAccountId, patientAccountId, _clock(), ciphertext));
            return true;
        }
    }

    /// <summary>Null if no link exists between the two accounts in this direction; otherwise the items in arrival order, possibly empty. Re-linking after Unlink surfaces whatever was shared before -- the list is keyed by account pair, not by link instance.</summary>
    public IReadOnlyList<SharedItem>? ListShared(Guid professionalAccountId, Guid patientAccountId)
    {
        lock (_lock)
        {
            if (!IsLinked(patientAccountId, professionalAccountId))
            {
                return null;
            }

            return _sharedItems.TryGetValue((patientAccountId, professionalAccountId), out var items)
                ? items.ToArray()
                : [];
        }
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

    private bool IsLinked(Guid patientAccountId, Guid professionalAccountId) =>
        _links.Exists(link => link.ProfessionalAccountId == professionalAccountId && link.PatientAccountId == patientAccountId);
}
