using Api.Data;
using Api.Platform;
using Npgsql;

namespace Api.Scheduling;

/// <summary>
/// Postgres-backed store for <c>scheduled_sessions</c>. Single implementation, no interface --
/// same reasoning as <c>Api.Patients.PatientRecordStore</c>: the ticket mandates a real
/// Testcontainers Postgres for the concurrency proof, so there is no in-memory fake to
/// substitute it for.
/// </summary>
public sealed class ScheduledSessionStore(NpgsqlDataSource dataSource)
{
    private const string SelectColumns =
        "id, tenant_id, patient_id, starts_at, duration_minutes, recording_active, cancelled_at, created_at";

    /// <summary>
    /// Inserts one session inside a tenant-scoped transaction. Two concurrent callers racing
    /// for the same (tenant_id, starts_at) among live rows: exactly one insert wins, the other
    /// hits <c>scheduled_sessions_live_slot_uq</c> and becomes a
    /// <see cref="ScheduledSessionSlotConflictException"/> -- acceptance criterion 1.
    /// </summary>
    public async Task<ScheduledSession> InsertAsync(
        Guid tenantId, Guid patientId, DateTimeOffset startsAt, int durationMinutes, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        await using var insertCommand = scope.Connection.CreateCommand();
        insertCommand.Transaction = scope.Transaction;
        insertCommand.CommandText = $"""
            INSERT INTO scheduled_sessions (tenant_id, patient_id, starts_at, duration_minutes)
            VALUES (@tenantId, @patientId, @startsAt, @durationMinutes)
            RETURNING {SelectColumns}
            """;
        insertCommand.Parameters.AddWithValue("tenantId", tenantId);
        insertCommand.Parameters.AddWithValue("patientId", patientId);
        insertCommand.Parameters.AddWithValue("startsAt", startsAt);
        insertCommand.Parameters.AddWithValue("durationMinutes", durationMinutes);

        ScheduledSession inserted;
        try
        {
            await using var reader = await insertCommand.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            inserted = ReadSession(reader);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new ScheduledSessionSlotConflictException();
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return inserted;
    }

    /// <summary>
    /// Moves a session to a new slot under a row lock (<c>SELECT ... FOR UPDATE</c>) so the
    /// guards in <see cref="LockAndGuardAsync"/> observe a state that cannot change out from
    /// under this transaction before the UPDATE commits.
    /// </summary>
    public async Task<Result<ScheduledSession, SchedulingFailureReason>> MoveAsync(
        Guid tenantId, Guid sessionId, DateTimeOffset newStartsAt, int newDurationMinutes, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        if (await LockAndGuardAsync(scope, sessionId, cancellationToken) is { } rejection)
        {
            return Result<ScheduledSession, SchedulingFailureReason>.Failure(rejection);
        }

        await using var updateCommand = scope.Connection.CreateCommand();
        updateCommand.Transaction = scope.Transaction;
        updateCommand.CommandText = $"""
            UPDATE scheduled_sessions
            SET starts_at = @startsAt, duration_minutes = @durationMinutes
            WHERE id = @id
            RETURNING {SelectColumns}
            """;
        updateCommand.Parameters.AddWithValue("startsAt", newStartsAt);
        updateCommand.Parameters.AddWithValue("durationMinutes", newDurationMinutes);
        updateCommand.Parameters.AddWithValue("id", sessionId);

        ScheduledSession moved;
        try
        {
            await using var reader = await updateCommand.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            moved = ReadSession(reader);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new ScheduledSessionSlotConflictException();
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return Result<ScheduledSession, SchedulingFailureReason>.Success(moved);
    }

    /// <summary>Same lock and same guards as <see cref="MoveAsync"/>; only writes <c>cancelled_at</c>.</summary>
    public async Task<Result<ScheduledSession, SchedulingFailureReason>> CancelAsync(
        Guid tenantId, Guid sessionId, DateTimeOffset cancelledAt, CancellationToken cancellationToken)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(tenantId, cancellationToken);

        if (await LockAndGuardAsync(scope, sessionId, cancellationToken) is { } rejection)
        {
            return Result<ScheduledSession, SchedulingFailureReason>.Failure(rejection);
        }

        await using var updateCommand = scope.Connection.CreateCommand();
        updateCommand.Transaction = scope.Transaction;
        updateCommand.CommandText = $"""
            UPDATE scheduled_sessions
            SET cancelled_at = @cancelledAt
            WHERE id = @id
            RETURNING {SelectColumns}
            """;
        updateCommand.Parameters.AddWithValue("cancelledAt", cancelledAt);
        updateCommand.Parameters.AddWithValue("id", sessionId);

        ScheduledSession cancelled;
        await using (var updateReader = await updateCommand.ExecuteReaderAsync(cancellationToken))
        {
            await updateReader.ReadAsync(cancellationToken);
            cancelled = ReadSession(updateReader);
        }

        await scope.Transaction.CommitAsync(cancellationToken);
        return Result<ScheduledSession, SchedulingFailureReason>.Success(cancelled);
    }

    /// <summary>
    /// Locks the row (<c>SELECT ... FOR UPDATE</c>) and runs the three guards Move and Cancel
    /// both need -- session exists, is not already cancelled, has no active recording -- exactly
    /// once instead of once per caller. Returns null when the row is clear to mutate.
    /// </summary>
    private static async Task<SchedulingFailureReason?> LockAndGuardAsync(
        TenantScopedTransaction scope, Guid sessionId, CancellationToken cancellationToken)
    {
        var locked = await LockForUpdateAsync(scope, sessionId, cancellationToken);
        if (locked is null)
        {
            return SchedulingFailureReason.SessionNotFound;
        }

        if (locked.CancelledAt is not null)
        {
            return SchedulingFailureReason.SessionCancelled;
        }

        if (locked.RecordingActive)
        {
            return SchedulingFailureReason.RecordingActive;
        }

        return null;
    }

    private static async Task<ScheduledSession?> LockForUpdateAsync(
        TenantScopedTransaction scope, Guid sessionId, CancellationToken cancellationToken)
    {
        await using var selectCommand = scope.Connection.CreateCommand();
        selectCommand.Transaction = scope.Transaction;
        selectCommand.CommandText = $"SELECT {SelectColumns} FROM scheduled_sessions WHERE id = @id FOR UPDATE";
        selectCommand.Parameters.AddWithValue("id", sessionId);

        await using var reader = await selectCommand.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return ReadSession(reader);
    }

    private static ScheduledSession ReadSession(NpgsqlDataReader reader) => new(
        reader.GetGuid(0),
        reader.GetGuid(1),
        reader.GetGuid(2),
        reader.GetFieldValue<DateTimeOffset>(3),
        reader.GetInt32(4),
        reader.GetBoolean(5),
        reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6),
        reader.GetFieldValue<DateTimeOffset>(7));
}
