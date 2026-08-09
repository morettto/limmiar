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

    /// <summary>Used by S02-02's professional-verification endpoints, which address an account by id, not e-mail.</summary>
    Task<Account?> FindByIdAsync(Guid id, CancellationToken cancellationToken);

    Task InsertAsync(Account account, CancellationToken cancellationToken);

    /// <summary>
    /// Persists a verification-status transition (Pending/InReview/Active/Rejected) on an
    /// account that already exists. Callers (<see cref="AccountService"/>) always
    /// FindByIdAsync a fresh copy first -- implementations don't need their own
    /// optimistic-concurrency check for this placeholder's single-writer scale.
    /// </summary>
    Task UpdateAsync(Account account, CancellationToken cancellationToken);

    /// <summary>
    /// The human review queue (S02-02, ADR-S02-05): professional accounts whose document
    /// path is <see cref="AccountVerificationStatus.InReview"/>, ordered by
    /// <see cref="Account.VerificationSubmittedAt"/> (oldest first) so the SLA clock is
    /// respected.
    /// </summary>
    Task<IReadOnlyList<Account>> ListPendingDocumentReviewAsync(CancellationToken cancellationToken);
}
