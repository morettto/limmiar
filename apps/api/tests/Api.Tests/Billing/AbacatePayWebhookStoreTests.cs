using Api.Billing;
using Api.Data;
using Api.Tests.Infrastructure;
using Npgsql;

namespace Api.Tests.Billing;

/// <summary>
/// AbacatePayWebhookStore.TryRecordAsync contra um Postgres real (forma S12-01, fatia 5): o
/// INSERT ... ON CONFLICT (event_id) DO NOTHING é a memória de idempotência do webhook.
/// Conecta como app_role (fixture.AppRoleConnectionString), nunca como superuser -- mesma
/// disciplina de ConsentEventsRlsTests, embora esta tabela não tenha RLS (ver
/// docs/adr/ADR-S12-01-dedupe-de-webhook-sem-rls.md e RowLevelSecurityCoverageTests).
/// </summary>
[Collection("Database")]
public sealed class AbacatePayWebhookStoreTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _fixture;
    private readonly List<NpgsqlDataSource> _createdDataSources = [];

    public AbacatePayWebhookStoreTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var dataSource in _createdDataSources)
        {
            await dataSource.DisposeAsync();
        }
    }

    [Fact]
    public async Task TryRecordAsync_FirstSightingOfEventId_ReturnsTrue()
    {
        var store = CreateStore();

        var recorded = await store.TryRecordAsync(NewEventId(), "billing.paid", CancellationToken.None);

        Assert.True(recorded);
    }

    [Fact]
    public async Task TryRecordAsync_SameEventIdAgain_ReturnsFalse()
    {
        var store = CreateStore();
        var eventId = NewEventId();
        await store.TryRecordAsync(eventId, "billing.paid", CancellationToken.None);

        var recordedAgain = await store.TryRecordAsync(eventId, "billing.paid", CancellationToken.None);

        Assert.False(recordedAgain);
    }

    [Fact]
    public async Task TryRecordAsync_DifferentEventId_ReturnsTrue()
    {
        var store = CreateStore();
        await store.TryRecordAsync(NewEventId(), "billing.paid", CancellationToken.None);

        var recorded = await store.TryRecordAsync(NewEventId(), "billing.paid", CancellationToken.None);

        Assert.True(recorded);
    }

    /// <summary>Sem UPDATE/DELETE para app_role -- a memória de idempotência nunca é reescrita
    /// nem podada pela aplicação em execução, mesma disciplina de consent_events.</summary>
    [Fact]
    public async Task RejectUpdateAndDeleteForAppRole()
    {
        await using var connection = new NpgsqlConnection(_fixture.AppRoleConnectionString);
        await connection.OpenAsync();

        await using (var updateCommand = connection.CreateCommand())
        {
            updateCommand.CommandText = "UPDATE abacatepay_webhook_events SET event = 'x' WHERE true";
            var ex = await Assert.ThrowsAsync<PostgresException>(() => updateCommand.ExecuteNonQueryAsync());
            Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
        }

        await using (var deleteCommand = connection.CreateCommand())
        {
            deleteCommand.CommandText = "DELETE FROM abacatepay_webhook_events WHERE true";
            var ex = await Assert.ThrowsAsync<PostgresException>(() => deleteCommand.ExecuteNonQueryAsync());
            Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState);
        }
    }

    private static string NewEventId() => $"log_{Guid.NewGuid():N}";

    private AbacatePayWebhookStore CreateStore()
    {
        var dataSource = NpgsqlDataSourceFactory.Create(_fixture.AppRoleConnectionString);
        _createdDataSources.Add(dataSource);
        return new AbacatePayWebhookStore(dataSource);
    }
}
