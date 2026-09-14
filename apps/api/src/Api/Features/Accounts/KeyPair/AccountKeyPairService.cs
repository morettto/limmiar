using Api.Platform;

namespace Api.Accounts;

public enum PublishKeyPairFailure
{
    AccountNotFound,

    PublicKeyConflict,
}

/// <summary>
/// Publishes and reads the account's static X25519 envelope (ADR-S11-06). The public key is
/// immutable once published: a second <see cref="PublishAsync"/> with the SAME public key
/// replaces the wrapped DEK / sealed private key (serves KEK rotation via rewrap), but a
/// DIFFERENT public key is a 409 -- the first publication wins, so two devices racing to
/// generate a pair converge on one.
/// </summary>
public sealed class AccountKeyPairService(IAccountStore accounts)
{
    public async Task<Result<AccountKeyPair, PublishKeyPairFailure>> PublishAsync(
        Guid accountId, AccountKeyPair pair, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return PublishKeyPairFailure.AccountNotFound;
        }

        if (account.KeyPair is { } existing && !existing.PublicKey.SequenceEqual(pair.PublicKey))
        {
            return PublishKeyPairFailure.PublicKeyConflict;
        }

        await accounts.UpdateAsync(account with { KeyPair = pair }, cancellationToken);
        return pair;
    }

    /// <summary>Null covers both "unknown account" and "account exists but never published a key pair" -- same as VoiceEnrollmentService.GetAsync.</summary>
    public async Task<AccountKeyPair?> GetAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(accountId, cancellationToken);
        return account?.KeyPair;
    }
}
