using Api.Accounts;
using Api.Data;
using Api.Tests.Infrastructure;
using Npgsql;
using Respawn;

namespace Api.Tests.Accounts;

/// <summary>
/// AccountKeyPairService against real Postgres (S11-03, fatia 6): exactly-one-wins is now a
/// database guarantee (INSERT ... ON CONFLICT ... WHERE public_key = EXCLUDED.public_key), not
/// an in-process SemaphoreSlim, so the proof has to run two concurrent calls against the same
/// row over real connections -- a fake store's in-memory racing (S11-04 review round 1) is no
/// longer representative of what actually serializes the write.
/// </summary>
[Collection("Database")]
public sealed class AccountKeyPairServiceTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _fixture;
    private Respawner _respawner = null!;
    private NpgsqlDataSource _dataSource = null!;

    public AccountKeyPairServiceTests(PostgresContainerFixture fixture)
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

        _dataSource = NpgsqlDataSourceFactory.Create(_fixture.AppRoleConnectionString);
    }

    public async Task DisposeAsync() => await _dataSource.DisposeAsync();

    [Fact]
    public async Task PublishAsync_TwoConcurrentPublishesWithDifferentPublicKeys_ExactlyOneWinsAndItsKeyIsStored()
    {
        var store = new PostgresAccountStore(_dataSource);
        var accountId = Guid.NewGuid();
        await store.InsertAsync(SomeAccount(accountId, "keypair-race@example.com"), CancellationToken.None);
        var service = new AccountKeyPairService(store, _dataSource);

        var pairA = new AccountKeyPair(SomePublicKey(0x01), SomeBlob(0x02), SomeBlob(0x03));
        var pairB = new AccountKeyPair(SomePublicKey(0x04), SomeBlob(0x05), SomeBlob(0x06));

        var results = await Task.WhenAll(
            Task.Run(() => service.PublishAsync(accountId, pairA, CancellationToken.None)),
            Task.Run(() => service.PublishAsync(accountId, pairB, CancellationToken.None)));

        var winners = results.Where(result => result.TryGetValue(out _)).ToList();
        Assert.Single(winners);
        winners[0].TryGetValue(out var winningPair);
        var stored = await service.GetAsync(accountId, CancellationToken.None);
        Assert.Equal(winningPair!.PublicKey, stored!.PublicKey);
    }

    [Fact]
    public async Task PublishAsync_WithUnknownAccountId_ReturnsAccountNotFound()
    {
        var store = new PostgresAccountStore(_dataSource);
        var service = new AccountKeyPairService(store, _dataSource);

        var result = await service.PublishAsync(
            Guid.NewGuid(), new AccountKeyPair(SomePublicKey(0x01), SomeBlob(0x02), SomeBlob(0x03)), CancellationToken.None);

        var failure = result.Match(_ => throw new InvalidOperationException("expected a failure"), reason => reason);
        Assert.Equal(PublishKeyPairFailure.AccountNotFound, failure);
    }

    /// <summary>
    /// The key pair lives in its own table (account_key_pairs), not a column on accounts -- a
    /// later UpdateAsync for something unrelated (voice enrollment here) must never touch it.
    /// Regression for the exact risk PatientLinkStore's README calls out: "UpdateAsync
    /// substitui o registo inteiro" used to mean a concurrent PUT key-pair / PUT voice could
    /// clobber each other when the pair was Account.KeyPair.
    /// </summary>
    [Fact]
    public async Task VoiceEnrollmentUpdateAfterPublish_KeepsThePair()
    {
        var store = new PostgresAccountStore(_dataSource);
        var accountId = Guid.NewGuid();
        var account = SomeAccount(accountId, "voice-after-keypair@example.com");
        await store.InsertAsync(account, CancellationToken.None);
        var service = new AccountKeyPairService(store, _dataSource);
        var pair = new AccountKeyPair(SomePublicKey(0x07), SomeBlob(0x08), SomeBlob(0x09));
        await service.PublishAsync(accountId, pair, CancellationToken.None);

        var withVoice = account with { VoiceEnrollment = new VoiceEnrollment(SomeBlob(0x0A), SomeBlob(0x0B)) };
        await store.UpdateAsync(withVoice, CancellationToken.None);

        var stillThere = await service.GetAsync(accountId, CancellationToken.None);
        Assert.NotNull(stillThere);
        Assert.Equal(pair.PublicKey, stillThere!.PublicKey);
        Assert.Equal(pair.WrappedDek, stillThere.WrappedDek);
        Assert.Equal(pair.SealedPrivateKey, stillThere.SealedPrivateKey);
    }

    private static Account SomeAccount(Guid id, string email) =>
        new(id, email, AccountRole.Patient, PasswordVerifier: null, GoogleSubjectId: null);

    private static byte[] SomePublicKey(byte fill)
    {
        var key = new byte[32];
        Array.Fill(key, fill);
        return key;
    }

    private static byte[] SomeBlob(byte fill)
    {
        var blob = new byte[28];
        Array.Fill(blob, fill);
        return blob;
    }
}
