using Api.Data;
using Npgsql;

namespace Api.Audit;

/// <summary>
/// Postgres-backed store for <c>audit_entries</c>. Single implementation, no interface --
/// same reasoning as <c>NoteSignatureStore</c>/<c>PatientRecordStore</c>: the RLS and
/// concurrency proofs need a real Testcontainers Postgres, so there is no in-memory fake to
/// substitute it for.
/// </summary>
/// <param name="maxAttempts">How many times <see cref="AppendAsync"/> re-reads the chain head
/// and retries before giving up. Not speculative config: the 100%-branch-coverage gate needs
/// the "ran out of attempts" path to be reachable, and the honest way there is a test that
/// builds the store with <c>maxAttempts: 1</c>. Default 8 comes from a measurement, not an
/// estimate: each retry round has exactly one winner, so N genuinely concurrent writers to the
/// same tenant need up to N attempts in the worst case (one straggler losing every earlier
/// round), and
/// <c>AppendAsync_WithEightConcurrentCalls_PersistsEightEntriesAndVerifyStaysIntact</c> drives
/// that worst case with eight writers against a real Postgres. The default is set to what that
/// test measured instead of sitting below it: under the observed worst case, real contention
/// makes <see cref="AppendAsync"/> return <c>null</c> and an audit entry vanishes without a
/// sound, and a lost audit entry is data loss. That test now builds the store with no explicit
/// maxAttempts, so the number under contention is the shipped one -- lower this and the proof
/// stops covering the concurrency it claims to cover.</param>
public sealed class AuditEntryStore(NpgsqlDataSource dataSource, int maxAttempts = 8)
{
    /// <summary>
    /// Reads the chain head, computes this entry's hash, and inserts it inside a
    /// tenant-scoped transaction. The <c>UNIQUE (tenant_id, previous_hash)</c> constraint
    /// (migration 0006) lets exactly one concurrent writer through per head; the loser here
    /// re-reads the (now advanced) head and retries, because losing silently would mean
    /// losing an audit entry. <paramref name="action"/> and <paramref name="deviceId"/> --
    /// and the single <c>recordedAt</c> instant captured once below -- never change across
    /// retries; only <c>sequence</c> and <c>previousHash</c> do, since those are the only
    /// fields a concurrent write can invalidate. Returns <c>null</c>, never throws, once
    /// <paramref name="maxAttempts"/> is exhausted.
    /// </summary>
    public async Task<AuditEntry?> AppendAsync(Guid tenantId, AuditAction action, Guid deviceId, CancellationToken ct)
    {
        var recordedAt = DateTimeOffset.UtcNow;

        for (var attempt = 0; attempt < maxAttempts; attempt++)
        {
            await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, ct);

            var head = await ReadChainHeadAsync(scope, ct);
            var (sequence, previousHash) = head is null
                ? (1L, AuditChain.GenesisHash.ToArray())
                : (head.Value.Sequence + 1, head.Value.EntryHash);
            var entryHash = AuditChain.ComputeHash(tenantId, sequence, action, deviceId, recordedAt, previousHash);

            await using var insertCommand = scope.Connection.CreateCommand();
            insertCommand.Transaction = scope.Transaction;
            insertCommand.CommandText = """
                INSERT INTO audit_entries (tenant_id, sequence, action, device_id, recorded_at, previous_hash, entry_hash)
                VALUES (@tenantId, @sequence, @action, @deviceId, @recordedAt, @previousHash, @entryHash)
                """;
            insertCommand.Parameters.AddWithValue("tenantId", tenantId);
            insertCommand.Parameters.AddWithValue("sequence", sequence);
            insertCommand.Parameters.AddWithValue("action", (short)action);
            insertCommand.Parameters.AddWithValue("deviceId", deviceId);
            insertCommand.Parameters.AddWithValue("recordedAt", recordedAt);
            insertCommand.Parameters.AddWithValue("previousHash", previousHash);
            insertCommand.Parameters.AddWithValue("entryHash", entryHash);

            if (await TryInsertAsync(insertCommand, ct))
            {
                await scope.Transaction.CommitAsync(ct);
                return new AuditEntry(tenantId, sequence, action, deviceId, recordedAt, previousHash, entryHash);
            }
        }

        return null;
    }

    /// <summary>Attempts the insert, reporting the lost-race case as <c>false</c> instead of
    /// letting it escape -- the caller decides whether to retry.</summary>
    private static async Task<bool> TryInsertAsync(NpgsqlCommand insertCommand, CancellationToken ct)
    {
        try
        {
            await insertCommand.ExecuteNonQueryAsync(ct);
            return true;
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return false;
        }
    }

    /// <summary>
    /// The full chain for one tenant, oldest first -- the shape <see cref="AuditChain.Verify"/>
    /// expects. Tenant isolation comes from the tenant_isolation RLS policy (via
    /// <see cref="NpgsqlDataSourceTenantExtensions.OpenTenantScopedTransactionAsync"/>), not
    /// from a WHERE tenant_id clause here -- same convention as
    /// <c>NoteSignatureStore.FindAsync</c>.
    /// </summary>
    /// <remarks>
    /// ponytail: materializes the entire chain into a <see cref="List{T}"/> in memory for
    /// <see cref="AuditChain.Verify"/> to walk. Fine while a tenant's trail is small; ceiling is
    /// whenever one tenant's chain grows large enough that holding it whole becomes the
    /// bottleneck. Upgrade path: page <c>sequence</c> ranges, or stream rows to a
    /// verifier that only needs the previous entry's hash in hand, instead of the whole list.
    /// </remarks>
    public async Task<IReadOnlyList<AuditEntry>> ListAsync(Guid tenantId, CancellationToken ct)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, ct);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = """
            SELECT tenant_id, sequence, action, device_id, recorded_at, previous_hash, entry_hash
            FROM audit_entries
            ORDER BY sequence
            """;

        var entries = new List<AuditEntry>();
        await using (var reader = await selectCommand.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                entries.Add(new AuditEntry(
                    reader.GetGuid(0),
                    reader.GetInt64(1),
                    (AuditAction)reader.GetInt16(2),
                    reader.GetGuid(3),
                    reader.GetFieldValue<DateTimeOffset>(4),
                    (byte[])reader[5],
                    (byte[])reader[6]));
            }
        }

        await scope.Transaction.CommitAsync(ct);
        return entries;
    }

    /// <summary>
    /// Writes down the chain head as it stands right now -- the witness
    /// <see cref="AuditChain.Verify"/> uses to catch a rewrite that recomputed every hash and
    /// therefore walks intact (acceptance criterion 3). Reading the head and inserting the
    /// anchor share one transaction, so the anchor can never witness a head that a concurrent
    /// <see cref="AppendAsync"/> moved in between. Returns <c>null</c> for an empty chain:
    /// there is no head to witness, and an anchor over nothing would claim something it cannot
    /// prove. This is the only producer of anchors -- no timer, no IHostedService (a line in
    /// Program.cs when the first real event producer arrives).
    /// </summary>
    /// <remarks>
    /// Ceiling and upgrade path (what this proves): see the ponytail comment in migration 0006.
    ///
    /// ponytail: unlike <see cref="AppendAsync"/>, this does not catch a <c>UniqueViolation</c>
    /// on <c>audit_anchors</c>' <c>PRIMARY KEY (tenant_id, anchored_at)</c> -- two captures for
    /// the same tenant at the same microsecond-resolution instant raise a raw
    /// <see cref="PostgresException"/> instead of retrying or returning null. Not covered by a
    /// test: <paramref name="ct"/> aside, <c>anchoredAt</c> is generated inside this method
    /// (<see cref="DateTimeOffset.UtcNow"/>), not injectable, so nothing today can force two
    /// calls onto the same instant to exercise that branch -- and an unreachable branch would
    /// break the 100%-branch-coverage gate. Upgrade path: inject the clock (as an
    /// <c>ISystemClock</c> or similar) to make the collision reproducible in a test, or catch
    /// <c>UniqueViolation</c> here and retry once the same way <see cref="AppendAsync"/> does,
    /// once there is a real timer/<c>IHostedService</c> capturing anchors on a cadence.
    /// </remarks>
    public async Task<AuditAnchor?> CaptureAnchorAsync(Guid tenantId, CancellationToken ct)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, ct);

        var head = await ReadChainHeadAsync(scope, ct);
        if (head is null)
        {
            return null;
        }

        var anchoredAt = DateTimeOffset.UtcNow;

        await using (var insertCommand = scope.Connection.CreateCommand())
        {
            insertCommand.Transaction = scope.Transaction;
            insertCommand.CommandText = """
                INSERT INTO audit_anchors (tenant_id, anchored_sequence, anchored_hash, anchored_at)
                VALUES (@tenantId, @anchoredSequence, @anchoredHash, @anchoredAt)
                """;
            insertCommand.Parameters.AddWithValue("tenantId", tenantId);
            insertCommand.Parameters.AddWithValue("anchoredSequence", head.Value.Sequence);
            insertCommand.Parameters.AddWithValue("anchoredHash", head.Value.EntryHash);
            insertCommand.Parameters.AddWithValue("anchoredAt", anchoredAt);
            await insertCommand.ExecuteNonQueryAsync(ct);
        }

        await scope.Transaction.CommitAsync(ct);
        return new AuditAnchor(tenantId, head.Value.Sequence, head.Value.EntryHash, anchoredAt);
    }

    /// <summary>Every anchor captured for one tenant, oldest first -- the second argument of
    /// <see cref="AuditChain.Verify"/>. Same tenant-scoping convention as
    /// <see cref="ListAsync"/>: the RLS policy isolates, not a WHERE clause here.</summary>
    public async Task<IReadOnlyList<AuditAnchor>> ListAnchorsAsync(Guid tenantId, CancellationToken ct)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, ct);

        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = """
            SELECT tenant_id, anchored_sequence, anchored_hash, anchored_at
            FROM audit_anchors
            ORDER BY anchored_at
            """;

        var anchors = new List<AuditAnchor>();
        await using (var reader = await selectCommand.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                anchors.Add(new AuditAnchor(
                    reader.GetGuid(0),
                    reader.GetInt64(1),
                    (byte[])reader[2],
                    reader.GetFieldValue<DateTimeOffset>(3)));
            }
        }

        await scope.Transaction.CommitAsync(ct);
        return anchors;
    }

    /// <summary>The tenant's chain head -- the newest entry's sequence and entry_hash, or
    /// <c>null</c> when the chain is still empty. Both callers need that distinction:
    /// <see cref="AppendAsync"/> turns an empty chain into genesis (sequence 1,
    /// <see cref="AuditChain.GenesisHash"/>), while <see cref="CaptureAnchorAsync"/> has
    /// nothing to witness at all.</summary>
    private static async Task<(long Sequence, byte[] EntryHash)?> ReadChainHeadAsync(TenantScopedTransaction scope, CancellationToken ct)
    {
        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = """
            SELECT sequence, entry_hash FROM audit_entries
            ORDER BY sequence DESC
            LIMIT 1
            """;

        await using var reader = await selectCommand.ExecuteReaderAsync(ct);
        if (await reader.ReadAsync(ct))
        {
            return (reader.GetInt64(0), (byte[])reader[1]);
        }

        return null;
    }
}
