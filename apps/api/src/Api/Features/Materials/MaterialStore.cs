using Api.Data;
using Npgsql;

namespace Api.Materials;

public sealed record MaterialSummary(Guid MaterialId, byte[] WrappedDek, byte[] MetadataCiphertext, bool Authorized, DateTimeOffset CreatedAt, bool InUse);
public sealed record MaterialContent(byte[] ContentCiphertext);
public sealed record CreateMaterialRequest(Guid MaterialId, byte[] WrappedDek, byte[] MetadataCiphertext, byte[] ContentCiphertext);
public sealed record MaterialAuthorizationRequest(bool Authorized);
public sealed record MaterialUsageRequest(Guid[] MaterialIds);
public enum MaterialMutation { Success, NotFound, NotAuthorized, InUse, SessionClosed }
public sealed record MaterialList(IReadOnlyList<MaterialSummary> Materials);

public sealed class MaterialStore(NpgsqlDataSource dataSource)
{
    public async Task<bool> CreateAsync(Guid ownerId, CreateMaterialRequest material, CancellationToken ct)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(ownerId, ct);
        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = """
            INSERT INTO professional_materials (tenant_id, material_id, wrapped_dek, metadata_ciphertext, content_ciphertext)
            VALUES (@owner, @id, @dek, @metadata, @content) ON CONFLICT DO NOTHING
            """;
        command.Parameters.AddWithValue("owner", ownerId);
        command.Parameters.AddWithValue("id", material.MaterialId);
        command.Parameters.AddWithValue("dek", material.WrappedDek);
        command.Parameters.AddWithValue("metadata", material.MetadataCiphertext);
        command.Parameters.AddWithValue("content", material.ContentCiphertext);
        var inserted = await command.ExecuteNonQueryAsync(ct) == 1;
        await scope.Transaction.CommitAsync(ct);
        return inserted;
    }

    public async Task<MaterialList> ListAsync(Guid ownerId, CancellationToken ct)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(ownerId, ct);
        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = "SELECT m.material_id, m.wrapped_dek, m.metadata_ciphertext, m.authorized, m.created_at, EXISTS (SELECT 1 FROM professional_material_usage u WHERE u.material_id = m.material_id) FROM professional_materials m ORDER BY m.created_at DESC, m.material_id";
        var materials = new List<MaterialSummary>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
                materials.Add(new MaterialSummary(reader.GetGuid(0), (byte[])reader[1], (byte[])reader[2], reader.GetBoolean(3), reader.GetFieldValue<DateTimeOffset>(4), reader.GetBoolean(5)));
        }
        await scope.Transaction.CommitAsync(ct);
        return new MaterialList(materials);
    }

    public async Task<MaterialContent?> GetContentAsync(Guid ownerId, Guid id, CancellationToken ct)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(ownerId, ct);
        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = "SELECT content_ciphertext FROM professional_materials WHERE material_id = @id";
        command.Parameters.AddWithValue("id", id);
        var result = await command.ExecuteScalarAsync(ct);
        await scope.Transaction.CommitAsync(ct);
        return result is byte[] bytes ? new MaterialContent(bytes) : null;
    }

    public async Task<bool> ContainsAsync(Guid ownerId, Guid[] ids, CancellationToken ct)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(ownerId, ct);
        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = "SELECT count(*) FROM professional_materials WHERE material_id = ANY(@ids)";
        command.Parameters.AddWithValue("ids", ids);
        var found = (long)(await command.ExecuteScalarAsync(ct))! == ids.Length;
        await scope.Transaction.CommitAsync(ct);
        return found;
    }

    public async Task<bool> SetAuthorizationAsync(Guid ownerId, Guid id, bool authorized, CancellationToken ct)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(ownerId, ct);
        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = "UPDATE professional_materials SET authorized = @authorized WHERE material_id = @id";
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("authorized", authorized);
        var changed = await command.ExecuteNonQueryAsync(ct) == 1;
        await scope.Transaction.CommitAsync(ct);
        return changed;
    }

    public async Task<MaterialMutation> SetUsageAsync(Guid ownerId, Guid sessionId, Guid[] materialIds, CancellationToken ct, Guid? captureId = null)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(ownerId, ct);
        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = "SELECT pg_advisory_xact_lock(hashtextextended(@session, 0))";
        command.Parameters.AddWithValue("session", $"{ownerId}/{sessionId}");
        await command.ExecuteNonQueryAsync(ct);
        command.Parameters.AddWithValue("sessionId", sessionId);
        if (materialIds.Length > 0 || captureId is not null)
        {
            command.CommandText = "SELECT EXISTS (SELECT 1 FROM professional_material_closed_sessions WHERE session_id = @sessionId)";
            if ((bool)(await command.ExecuteScalarAsync(ct))!) return MaterialMutation.SessionClosed;
        }
        if (materialIds.Length == 0 && captureId is null)
        {
            command.CommandText = "SELECT EXISTS (SELECT 1 FROM professional_material_captures WHERE session_id = @sessionId AND NOT released)";
            if ((bool)(await command.ExecuteScalarAsync(ct))!) return MaterialMutation.InUse;
        }
        command.CommandText = "SELECT material_id, authorized FROM professional_materials WHERE material_id = ANY(@ids) ORDER BY material_id FOR UPDATE";
        command.Parameters.AddWithValue("ids", materialIds);
        var found = new Dictionary<Guid, bool>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) found.Add(reader.GetGuid(0), reader.GetBoolean(1));
        if (found.Count != materialIds.Length) return MaterialMutation.NotFound;
        if (found.Values.Any(authorized => !authorized)) return MaterialMutation.NotAuthorized;
        command.CommandText = materialIds.Length == 0 && captureId is null
            ? "DELETE FROM professional_material_usage WHERE session_id = @sessionId"
            : "INSERT INTO professional_material_usage (tenant_id, session_id, material_id) SELECT @owner, @sessionId, unnest(@ids) ON CONFLICT DO NOTHING";
        command.Parameters.AddWithValue("owner", ownerId);
        await command.ExecuteNonQueryAsync(ct);
        if (materialIds.Length == 0 && captureId is null)
        {
            command.CommandText = "INSERT INTO professional_material_closed_sessions (tenant_id, session_id) VALUES (@owner, @sessionId) ON CONFLICT DO NOTHING";
            await command.ExecuteNonQueryAsync(ct);
        }
        if (captureId is not null)
        {
            command.CommandText = "INSERT INTO professional_material_captures (tenant_id, session_id, capture_id) VALUES (@owner, @sessionId, @captureId) ON CONFLICT DO NOTHING";
            command.Parameters.AddWithValue("captureId", captureId.Value);
            await command.ExecuteNonQueryAsync(ct);
            command.CommandText = "SELECT released FROM professional_material_captures WHERE session_id = @sessionId AND capture_id = @captureId";
            if ((bool)(await command.ExecuteScalarAsync(ct))!) return MaterialMutation.SessionClosed;
        }
        await scope.Transaction.CommitAsync(ct);
        return MaterialMutation.Success;
    }

    public async Task ReleaseCaptureAsync(Guid ownerId, Guid sessionId, Guid captureId, CancellationToken ct)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(ownerId, ct);
        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = "SELECT pg_advisory_xact_lock(hashtextextended(@session, 0))";
        command.Parameters.AddWithValue("session", $"{ownerId}/{sessionId}");
        await command.ExecuteNonQueryAsync(ct);
        command.CommandText = "INSERT INTO professional_material_captures (tenant_id, session_id, capture_id, released) VALUES (@owner, @sessionId, @captureId, true) ON CONFLICT (tenant_id, session_id, capture_id) DO UPDATE SET released = true";
        command.Parameters.AddWithValue("owner", ownerId);
        command.Parameters.AddWithValue("sessionId", sessionId);
        command.Parameters.AddWithValue("captureId", captureId);
        await command.ExecuteNonQueryAsync(ct);
        await scope.Transaction.CommitAsync(ct);
    }

    public async Task<MaterialMutation> DeleteAsync(Guid ownerId, Guid id, CancellationToken ct)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(ownerId, ct);
        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = "SELECT material_id FROM professional_materials WHERE material_id = @id FOR UPDATE";
        command.Parameters.AddWithValue("id", id);
        if (await command.ExecuteScalarAsync(ct) is null) return MaterialMutation.NotFound;
        command.CommandText = "SELECT EXISTS (SELECT 1 FROM professional_material_usage WHERE material_id = @id)";
        if ((bool)(await command.ExecuteScalarAsync(ct))!) return MaterialMutation.InUse;
        command.CommandText = "DELETE FROM professional_materials WHERE material_id = @id";
        await command.ExecuteNonQueryAsync(ct);
        await scope.Transaction.CommitAsync(ct);
        return MaterialMutation.Success;
    }
}
