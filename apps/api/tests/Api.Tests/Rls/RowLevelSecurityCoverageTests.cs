using Api.Tests.Infrastructure;
using Npgsql;

namespace Api.Tests.Rls;

/// <summary>
/// A invariante que substitui a exceção em prosa da ADR-S12-01: toda tabela do schema public
/// tem row-level security ligada, exceto <c>abacatepay_webhook_events</c> (dedupe de webhook,
/// sem tenant no instante da escrita -- ver docs/adr/ADR-S12-01-dedupe-de-webhook-sem-rls.md).
/// Cobre as 7 tabelas existentes de borla, porque a query lê pg_class inteiro -- uma tabela
/// nova que esqueça ENABLE ROW LEVEL SECURITY falha aqui em vez de sair silenciosamente
/// insegura entre tenants.
/// </summary>
[Collection("Database")]
public sealed class RowLevelSecurityCoverageTests
{
    private readonly PostgresContainerFixture _fixture;

    public RowLevelSecurityCoverageTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task AllTablesHaveRowLevelSecurity_ExceptTheWebhookDedupeTable()
    {
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT relname, relrowsecurity
            FROM pg_class
            WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
            """;

        var tablesWithoutRls = new List<string>();
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                if (!reader.GetBoolean(1))
                {
                    tablesWithoutRls.Add(reader.GetString(0));
                }
            }
        }

        Assert.Equal(["abacatepay_webhook_events"], tablesWithoutRls);
    }
}
