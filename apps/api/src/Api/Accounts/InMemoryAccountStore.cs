using System.Collections.Concurrent;

namespace Api.Accounts;

/// <summary>
/// TODO(follow-up ticket -- not one of S02-01's confirmed backend seams, see the
/// session's final report): replace with a Postgres-backed, RLS-protected
/// implementation once account persistence gets its own scoped ticket. See
/// apps/api/tests/Api.Tests/Rls and migrations/0001_create_health_check_probe.sql for
/// the pattern this repo already uses to prove RLS policies against a real Postgres
/// instance (health_check_probe) -- an accounts table would follow the same
/// FORCE ROW LEVEL SECURITY approach.
///
/// This in-memory placeholder exists only so AuthEndpoints has a complete, working
/// composition today: accounts do not survive a process restart and are not shared
/// across instances. Single-writer safe (the only caller, AccountService, always
/// FindByEmailAsync-checks before InsertAsync-ing), so this deliberately does not
/// implement a compare-and-swap/atomic-insert -- concurrent registration of the same
/// e-mail racing past that check is a real gap the future Postgres-backed
/// implementation (a UNIQUE constraint) should close, not this placeholder.
/// </summary>
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
