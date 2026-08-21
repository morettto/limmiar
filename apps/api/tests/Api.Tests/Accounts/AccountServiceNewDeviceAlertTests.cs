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
        private readonly Dictionary<string, Account> _accountsByEmail = new(StringComparer.Ordinal);

        public FakeAccountStore(params Account[] seed)
        {
            foreach (var account in seed)
            {
                _accountsByEmail[account.Email] = account;
            }
        }

        public Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken) =>
            Task.FromResult(_accountsByEmail.GetValueOrDefault(normalizedEmail));

        public Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult(_accountsByEmail.Values.FirstOrDefault(account => account.Id == id));

        public Task InsertAsync(Account account, CancellationToken cancellationToken)
        {
            _accountsByEmail[account.Email] = account;
            return Task.CompletedTask;
        }

        public Task UpdateAsync(Account account, CancellationToken cancellationToken)
        {
            _accountsByEmail[account.Email] = account;
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Account>>([]);
    }
}
