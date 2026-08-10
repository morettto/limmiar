using System.Collections.Concurrent;

namespace Api.Accounts;

// Placeholder in-memory store: no persistence across restarts, no cross-instance sharing.
public sealed class InMemoryAccountStore : IAccountStore
{
    private readonly ConcurrentDictionary<string, Account> _accountsByEmail = new(StringComparer.Ordinal);

    public Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken)
    {
        _accountsByEmail.TryGetValue(normalizedEmail, out var account);
        return Task.FromResult(account);
    }

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

    public Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken cancellationToken)
    {
        IReadOnlyList<Account> queue = _accountsByEmail.Values
            .Where(account => account.Role == AccountRole.Professional && account.VerificationStatus == AccountVerificationStatus.InReview)
            .OrderBy(account => account.VerificationSubmittedAt)
            .ToList();
        return Task.FromResult(queue);
    }
}
