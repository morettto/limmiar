using System.Collections.Concurrent;

// Namespace stays Api.Accounts (not Api.Tests.Fakes) even though the file now lives under
// tests/ -- this is a test fake for IAccountStore (moved here in S11-03, fatia 6, when
// PostgresAccountStore became the real IAccountStore), and every existing caller already has
// `using Api.Accounts;` for Account/AccountRole/etc., so keeping the namespace avoids a
// mechanical using-directive churn across every file that swaps this fake in.
namespace Api.Accounts;

/// <summary>Test-only fake for <see cref="IAccountStore"/> (real store is
/// <see cref="PostgresAccountStore"/>): no persistence across restarts, no cross-instance
/// sharing, no Postgres/RLS involved. Used where a test needs an account to exist but is not
/// itself proving anything about accounts persistence (see NoteServiceTests).</summary>
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
