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

    [Fact]
    public async Task FindByIdAsync_WithNoMatchingAccount_ReturnsNull()
    {
        var store = new InMemoryAccountStore();

        var found = await store.FindByIdAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Null(found);
    }

    [Fact]
    public async Task InsertAsync_ThenFindByIdAsync_ReturnsInsertedAccount()
    {
        var store = new InMemoryAccountStore();
        var account = new Account(Guid.NewGuid(), "by-id@example.com", AccountRole.Professional, new byte[AccountService.PasswordVerifierLength], null);

        await store.InsertAsync(account, CancellationToken.None);
        var found = await store.FindByIdAsync(account.Id, CancellationToken.None);

        Assert.Equal(account, found);
    }

    [Fact]
    public async Task UpdateAsync_PersistsChangedVerificationStatus()
    {
        var store = new InMemoryAccountStore();
        var account = new Account(
            Guid.NewGuid(), "to-update@example.com", AccountRole.Professional, new byte[AccountService.PasswordVerifierLength], null,
            AccountVerificationStatus.Pending);
        await store.InsertAsync(account, CancellationToken.None);

        var updated = account with { VerificationStatus = AccountVerificationStatus.Active };
        await store.UpdateAsync(updated, CancellationToken.None);

        var found = await store.FindByIdAsync(account.Id, CancellationToken.None);
        Assert.Equal(AccountVerificationStatus.Active, found!.VerificationStatus);
    }

    [Fact]
    public async Task ListPendingDocumentReviewAsync_ReturnsOnlyInReviewProfessionals_OrderedByOldestSubmissionFirst()
    {
        var store = new InMemoryAccountStore();
        var newer = new Account(
            Guid.NewGuid(), "newer@example.com", AccountRole.Professional, new byte[AccountService.PasswordVerifierLength], null,
            AccountVerificationStatus.InReview, VerificationSubmittedAt: DateTimeOffset.UtcNow);
        var older = new Account(
            Guid.NewGuid(), "older@example.com", AccountRole.Professional, new byte[AccountService.PasswordVerifierLength], null,
            AccountVerificationStatus.InReview, VerificationSubmittedAt: DateTimeOffset.UtcNow.AddDays(-1));
        var activeProfessional = new Account(
            Guid.NewGuid(), "active@example.com", AccountRole.Professional, new byte[AccountService.PasswordVerifierLength], null,
            AccountVerificationStatus.Active);
        var patient = new Account(Guid.NewGuid(), "patient@example.com", AccountRole.Patient, new byte[AccountService.PasswordVerifierLength], null);

        await store.InsertAsync(newer, CancellationToken.None);
        await store.InsertAsync(older, CancellationToken.None);
        await store.InsertAsync(activeProfessional, CancellationToken.None);
        await store.InsertAsync(patient, CancellationToken.None);

        var queue = await store.ListPendingDocumentReviewAsync(CancellationToken.None);

        Assert.Equal(new[] { older.Id, newer.Id }, queue.Select(a => a.Id));
    }
}
