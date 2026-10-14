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
    private readonly ConcurrentDictionary<Guid, Account> _accountsById = new();

    public Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken)
    {
        var account = _accountsById.Values.FirstOrDefault(account => account.Email == normalizedEmail);
        return Task.FromResult(account);
    }

    public Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
        Task.FromResult(_accountsById.GetValueOrDefault(id));

    public Task InsertAsync(Account account, CancellationToken cancellationToken)
    {
        _accountsById[account.Id] = account;
        return Task.CompletedTask;
    }

    public Task<Account?> MutateAsync(Guid id, Func<Account, Account?> mutation, CancellationToken cancellationToken)
    {
        while (_accountsById.TryGetValue(id, out var current))
        {
            var updated = mutation(current);
            if (updated is null) return Task.FromResult<Account?>(null);
            if (updated.Id != id) throw new ArgumentException("An account mutation cannot change its identity.", nameof(mutation));
            if (_accountsById.TryUpdate(id, updated, current)) return Task.FromResult<Account?>(updated);
        }
        return Task.FromResult<Account?>(null);
    }

    public async Task<string?> GetOrCreatePendingTotpSecretAsync(Guid id, string candidate, CancellationToken cancellationToken)
    {
        var account = await FindByIdAsync(id, cancellationToken);
        if (account is null) return null;
        while (_accountsById.TryGetValue(account.Id, out var current))
        {
            if (current.Role != AccountRole.Professional || current.TotpEnabledAt is not null) return null;
            if (current.TotpSecret is { } secret) return secret;
            if (_accountsById.TryUpdate(current.Id, current with { TotpSecret = candidate }, current)) return candidate;
        }
        return null;
    }

    public Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken cancellationToken)
    {
        IReadOnlyList<Account> queue = _accountsById.Values
            .Where(account => account.Role == AccountRole.Professional && account.VerificationStatus == AccountVerificationStatus.InReview)
            .OrderBy(account => account.VerificationSubmittedAt)
            .ToList();
        return Task.FromResult(queue);
    }
}
