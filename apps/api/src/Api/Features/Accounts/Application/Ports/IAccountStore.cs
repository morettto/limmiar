namespace Api.Accounts;

public interface IAccountStore
{
    Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken);

    Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken);

    Task InsertAsync(Account account, CancellationToken cancellationToken);

    Task UpdateAsync(Account account, CancellationToken cancellationToken);

    Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken cancellationToken);
}
