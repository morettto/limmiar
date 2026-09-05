using Api.Accounts;
using Api.Data;
using Api.Notes;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Notes;

/// <summary>
/// NoteService's authorization/state logic, against a real Postgres-backed
/// NoteSignatureStore (an in-memory IAccountStore fake is enough for accounts -- the RLS
/// proof itself lives in NoteSignaturesRlsTests, not here).
/// </summary>
[Collection("Database")]
public sealed class NoteServiceTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _fixture;
    private readonly List<NpgsqlDataSource> _createdDataSources = [];
    private Respawner _respawner = null!;

    public NoteServiceTests(PostgresContainerFixture fixture)
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

    public async Task DisposeAsync()
    {
        foreach (var dataSource in _createdDataSources)
        {
            await dataSource.DisposeAsync();
        }
    }

    [Fact]
    public async Task SignAsync_WithUnknownAccountId_ReturnsAccountNotFound()
    {
        var service = CreateService(new InMemoryAccountStore());

        var result = await service.SignAsync(Guid.NewGuid(), Guid.NewGuid(), 0, new byte[60], CancellationToken.None);

        Assert.True(result.TryGetFailure(out var failureReason));
        Assert.Equal(SignNoteFailureReason.AccountNotFound, failureReason);
    }

    [Fact]
    public async Task SignAsync_WithUnverifiedProfessional_ReturnsNotAuthorizedToCreateRecords()
    {
        var accounts = new InMemoryAccountStore();
        var account = new Account(Guid.NewGuid(), "unverified@example.com", AccountRole.Professional, null, null, AccountVerificationStatus.Pending);
        await accounts.InsertAsync(account, CancellationToken.None);
        var service = CreateService(accounts);

        var result = await service.SignAsync(account.Id, Guid.NewGuid(), 0, new byte[60], CancellationToken.None);

        Assert.True(result.TryGetFailure(out var failureReason));
        Assert.Equal(SignNoteFailureReason.NotAuthorizedToCreateRecords, failureReason);
    }

    [Fact]
    public async Task SignAsync_ForAlreadySignedNote_ReturnsAlreadySigned()
    {
        var accounts = new InMemoryAccountStore();
        var account = new Account(Guid.NewGuid(), "active@example.com", AccountRole.Professional, null, null, AccountVerificationStatus.Active);
        await accounts.InsertAsync(account, CancellationToken.None);
        var service = CreateService(accounts);
        var noteId = Guid.NewGuid();
        await service.SignAsync(account.Id, noteId, 0, new byte[60], CancellationToken.None);

        var result = await service.SignAsync(account.Id, noteId, 0, new byte[60], CancellationToken.None);

        Assert.True(result.TryGetFailure(out var failureReason));
        Assert.Equal(SignNoteFailureReason.AlreadySigned, failureReason);
    }

    private NoteService CreateService(IAccountStore accounts)
    {
        var dataSource = NpgsqlDataSourceFactory.Create(_fixture.AppRoleConnectionString);
        _createdDataSources.Add(dataSource);
        return new NoteService(accounts, new NoteSignatureStore(dataSource));
    }
}
