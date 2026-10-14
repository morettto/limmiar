namespace Api.Accounts;

public interface IAccountStore
{
    Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken);

    Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken);

    Task InsertAsync(Account account, CancellationToken cancellationToken);

    // Mutations must be pure: stores may retry against the latest state after contention.
    Task<Account?> MutateAsync(Guid id, Func<Account, Account?> mutation, CancellationToken cancellationToken);

    Task<string?> GetOrCreatePendingTotpSecretAsync(Guid id, string candidate, CancellationToken cancellationToken);

    Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken cancellationToken);
}
