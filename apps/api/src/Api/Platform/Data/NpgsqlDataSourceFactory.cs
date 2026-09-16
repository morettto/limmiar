using Npgsql;

namespace Api.Data;

/// <summary>
/// Builds AOT-safe <see cref="NpgsqlDataSource"/> instances via <see cref="NpgsqlSlimDataSourceBuilder"/>.
/// The slim builder avoids the reflection-based plugin auto-detection that the full
/// <see cref="NpgsqlDataSourceBuilder"/> performs, keeping Native AOT publish clean.
/// </summary>
public static class NpgsqlDataSourceFactory
{
    public static NpgsqlDataSource Create(string connectionString)
    {
        var builder = new NpgsqlSlimDataSourceBuilder(connectionString);
        // The slim builder does not wire up array support by default (kept out for AOT/trimming
        // size); accounts.totp_backup_code_hashes is a text[], the first array column in this
        // codebase. EnableArrays() is documented AOT-safe (source-generated, no reflection).
        builder.EnableArrays();
        return builder.Build();
    }
}
