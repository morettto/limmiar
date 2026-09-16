using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Billing;

/// <summary>
/// S12-02 blocker 2: o webhook e a política RLS <c>payment_lookup</c> leem
/// <c>booking_payments</c> por <c>checkout_id</c> (a PK é <c>external_id</c>) -- sem índice
/// próprio isso é seq scan a cada webhook. Prova contra <c>pg_indexes</c> real, molde
/// <c>ConsentEventsSchemaTests</c>.
/// </summary>
[Collection("Database")]
public sealed class BookingPaymentsSchemaTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;

    public BookingPaymentsSchemaTests(PostgresContainerFixture fixture)
    {
        _fixture = fixture;
    }

    public async Task InitializeAsync()
    {
        await using var adminConnection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await adminConnection.OpenAsync();

        _respawner = await Respawner.CreateAsync(adminConnection, new RespawnerOptions
        {
            SchemasToInclude = ["public"],
            DbAdapter = DbAdapter.Postgres,
        });
        await _respawner.ResetAsync(adminConnection);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task BookingPayments_HasIndexOnCheckoutId()
    {
        await using var connection = new NpgsqlConnection(_fixture.AdminConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT indexname FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'booking_payments' AND indexdef ILIKE '%checkout_id%'
            """;

        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync(), "Expected an index covering checkout_id on booking_payments");
    }
}
