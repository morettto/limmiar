namespace Api.Accounts;

/// <summary>
/// Persistence seam for <see cref="Account"/>. <see cref="AccountService"/> is the only
/// intended caller and is responsible for normalizing email casing/whitespace before
/// calling either member here -- implementations are free to assume
/// <paramref name="normalizedEmail"/>/<c>account.Email</c> is already normalized.
/// </summary>
public interface IAccountStore
{
    Task<Account?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken);

    Task InsertAsync(Account account, CancellationToken cancellationToken);
}
