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
        return builder.Build();
    }
}
