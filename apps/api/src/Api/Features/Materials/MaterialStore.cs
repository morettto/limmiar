using Api.Data;
using Npgsql;

namespace Api.Materials;

public sealed record MaterialSummary(Guid MaterialId, byte[] WrappedDek, byte[] MetadataCiphertext, bool Authorized, DateTimeOffset CreatedAt);
public sealed record MaterialContent(byte[] ContentCiphertext);
public sealed record CreateMaterialRequest(Guid MaterialId, byte[] WrappedDek, byte[] MetadataCiphertext, byte[] ContentCiphertext);
public sealed record MaterialAuthorizationRequest(bool Authorized);
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
        command.CommandText = "SELECT material_id, wrapped_dek, metadata_ciphertext, authorized, created_at FROM professional_materials ORDER BY created_at DESC, material_id";
        var materials = new List<MaterialSummary>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
                materials.Add(new MaterialSummary(reader.GetGuid(0), (byte[])reader[1], (byte[])reader[2], reader.GetBoolean(3), reader.GetFieldValue<DateTimeOffset>(4)));
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

    public async Task<bool> DeleteAsync(Guid ownerId, Guid id, CancellationToken ct)
    {
        await using var scope = await dataSource.OpenTenantScopedTransactionAsync(ownerId, ct);
        await using var command = scope.Connection.CreateCommand();
        command.Transaction = scope.Transaction;
        command.CommandText = "DELETE FROM professional_materials WHERE material_id = @id";
        command.Parameters.AddWithValue("id", id);
        var removed = await command.ExecuteNonQueryAsync(ct) == 1;
        await scope.Transaction.CommitAsync(ct);
        return removed;
    }
}
