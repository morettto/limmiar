using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Concurrency regression for AccountKeyPairService.PublishAsync (S11-04 review round 1
/// blocker): find-then-check-then-update through IAccountStore is not atomic by itself, so two
/// concurrent publishes with different public keys could both pass the conflict check and the
/// second silently overwrite the first, violating "first publication wins" (see the type's XML
/// doc). Mirrors PatientLinkStoreTests.Redeem_TwoConcurrentAttemptsOnSameCode_ExactlyOneWins, but
/// a plain Parallel.For over PublishAsync is not deterministic enough here (InMemoryAccountStore
/// never actually awaits, so the two calls rarely interleave) -- this store double inserts a
/// real await inside FindByIdAsync so both concurrently-launched calls reliably capture the same
/// pre-update snapshot before either writes back.
/// </summary>
public sealed class AccountKeyPairServiceTests
{
    [Fact]
    public async Task PublishAsync_TwoConcurrentPublishesWithDifferentPublicKeys_ExactlyOneWinsAndItsKeyIsStored()
    {
        var accountId = Guid.NewGuid();
        var account = new Account(accountId, "keypair-race@example.com", AccountRole.Professional, null, null);
        var store = new SlowFindAccountStore(account);
        var service = new AccountKeyPairService(store);

        var pairA = new AccountKeyPair(SomePublicKey(0x01), SomeBlob(0x02), SomeBlob(0x03));
        var pairB = new AccountKeyPair(SomePublicKey(0x04), SomeBlob(0x05), SomeBlob(0x06));

        var results = await Task.WhenAll(
            Task.Run(() => service.PublishAsync(accountId, pairA, CancellationToken.None)),
            Task.Run(() => service.PublishAsync(accountId, pairB, CancellationToken.None)));

        var winners = results.Where(result => result.TryGetValue(out _)).ToList();
        Assert.Single(winners);
        winners[0].TryGetValue(out var winningPair);
        Assert.Equal(winningPair!.PublicKey, store.Current!.KeyPair!.PublicKey);
    }

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

    /// <summary>
    /// FindByIdAsync captures the current account, then awaits a short delay before returning it
    /// -- long enough that two calls launched back-to-back via Task.Run both capture the same
    /// pre-update snapshot when nothing serializes them, but that adds no risk of hanging once
    /// PublishAsync correctly serializes find+check+update: the second call then only starts
    /// after the first is fully done, sees the updated account, and the delay just adds latency.
    /// </summary>
    private sealed class SlowFindAccountStore(Account seed) : IAccountStore
    {
        private static readonly TimeSpan FindDelay = TimeSpan.FromMilliseconds(50);

        public Account? Current { get; private set; } = seed;

        public async Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken)
        {
            var snapshot = Current;
            await Task.Delay(FindDelay, cancellationToken);
            return snapshot;
        }

        public Task UpdateAsync(Account account, CancellationToken cancellationToken)
        {
            Current = account;
            return Task.CompletedTask;
        }

        public Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken) =>
            throw new NotSupportedException("not needed by this test");

        public Task InsertAsync(Account account, CancellationToken cancellationToken) =>
            throw new NotSupportedException("not needed by this test");

        public Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken cancellationToken) =>
            throw new NotSupportedException("not needed by this test");
    }
}
