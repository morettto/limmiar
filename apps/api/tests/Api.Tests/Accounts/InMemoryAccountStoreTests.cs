using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class InMemoryAccountStoreTests
{
    [Fact]
    public async Task FindByEmailAsync_WithNoMatchingAccount_ReturnsNull()
    {
        var store = new InMemoryAccountStore();

        var found = await store.FindByEmailAsync("nobody@example.com", CancellationToken.None);

        Assert.Null(found);
    }

    [Fact]
    public async Task InsertAsync_ThenFindByEmailAsync_ReturnsInsertedAccount()
    {
        var store = new InMemoryAccountStore();
        var account = new Account(Guid.NewGuid(), "someone@example.com", AccountRole.Patient, new byte[AccountService.PasswordVerifierLength], null);

        await store.InsertAsync(account, CancellationToken.None);
        var found = await store.FindByEmailAsync("someone@example.com", CancellationToken.None);

        Assert.Equal(account, found);
    }
}
