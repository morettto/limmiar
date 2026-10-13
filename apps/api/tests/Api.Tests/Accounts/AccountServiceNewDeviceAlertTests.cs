using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class AccountServiceNewDeviceAlertTests
{
    [Fact]
    public async Task NotifyNewDeviceLinkedAsync_WithExistingAccount_SendsToItsEmail()
    {
        var account = new Account(Guid.NewGuid(), "owner@example.com", AccountRole.Patient, null, null);
        var sender = new CapturingNewDeviceAlertSender();
        var notifier = new NewDeviceAlertNotifier(new FakeAccountStore(account), sender);

        await notifier.NotifyNewDeviceLinkedAsync(account.Id, CancellationToken.None);

        Assert.True(sender.WasSentTo("owner@example.com"));
    }

    [Fact]
    public async Task NotifyNewDeviceLinkedAsync_WithUnknownAccountId_DoesNotSendAndDoesNotThrow()
    {
        var sender = new CapturingNewDeviceAlertSender();
        var notifier = new NewDeviceAlertNotifier(new FakeAccountStore(), sender);

        await notifier.NotifyNewDeviceLinkedAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.False(sender.WasSentTo("owner@example.com"));
    }

    // Uses the real, NotSupportedException-throwing NewDeviceAlertSender placeholder, not a
    // fake, so the swallow-on-failure is proven against the actual production failure mode.
    [Fact]
    public async Task NotifyNewDeviceLinkedAsync_WhenAlertSenderThrows_CompletesWithoutThrowing()
    {
        var account = new Account(Guid.NewGuid(), "throwing-sender@example.com", AccountRole.Patient, null, null);
        var notifier = new NewDeviceAlertNotifier(new FakeAccountStore(account), new NewDeviceAlertSender());

        await notifier.NotifyNewDeviceLinkedAsync(account.Id, CancellationToken.None);
    }

    private sealed class FakeAccountStore : IAccountStore
    {
        private readonly Dictionary<Guid, Account> _accountsByEmail = new();

        public FakeAccountStore(params Account[] seed)
        {
            foreach (var account in seed)
            {
                _accountsByEmail[account.Id] = account;
            }
        }

        public Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken) =>
            Task.FromResult(_accountsByEmail.Values.FirstOrDefault(account => account.Email == normalizedEmail));

        public Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult(_accountsByEmail.Values.FirstOrDefault(account => account.Id == id));

        public async Task<string?> GetOrCreatePendingTotpSecretAsync(Guid id, string candidate, CancellationToken cancellationToken)
        {
            var account = await FindByIdAsync(id, cancellationToken);
            if (account is null || account.Role != AccountRole.Professional || account.TotpEnabledAt is not null) return null;
            var secret = account.TotpSecret ?? candidate;
            await MutateAsync(account.Id, current => current with { TotpSecret = secret }, cancellationToken);
            return secret;
        }

        public Task InsertAsync(Account account, CancellationToken cancellationToken)
        {
            _accountsByEmail[account.Id] = account;
            return Task.CompletedTask;
        }

        public Task<Account?> MutateAsync(Guid id, Func<Account, Account?> mutation, CancellationToken cancellationToken)
        {
            if (!_accountsByEmail.TryGetValue(id, out var current)) return Task.FromResult<Account?>(null);
            var updated = mutation(current);
            if (updated is not null) _accountsByEmail[id] = updated;
            return Task.FromResult(updated);
        }

        public Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Account>>([]);
    }
}
