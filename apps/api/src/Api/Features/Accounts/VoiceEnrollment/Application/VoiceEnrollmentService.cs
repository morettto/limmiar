namespace Api.Accounts;

public sealed class VoiceEnrollmentService(IAccountStore accounts)
{
    public async Task<VoiceEnrollmentResult> EnrollAsync(
        Guid accountId, byte[] wrappedDek, byte[] sealedEmbedding, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return VoiceEnrollmentResult.Failure(VoiceEnrollmentFailureReason.AccountNotFound);
        }

        // Idempotent: re-enrollment overwrites the previous wrapped DEK and embedding instead of
        // accumulating -- there is exactly one voice cadastro per account, not a history.
        await accounts.UpdateAsync(
            account with { VoiceEnrollment = new VoiceEnrollment(wrappedDek, sealedEmbedding) },
            cancellationToken);
        return VoiceEnrollmentResult.Success();
    }

    /// <summary>Null covers both "unknown account" and "account exists but never enrolled" -- same as EnrollAsync/DeleteAsync, an unknown account is a normal not-found outcome here, not an exceptional one.</summary>
    public async Task<VoiceEnrollment?> GetAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(accountId, cancellationToken);
        return account?.VoiceEnrollment;
    }

    public async Task<VoiceEnrollmentResult> DeleteAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return VoiceEnrollmentResult.Failure(VoiceEnrollmentFailureReason.AccountNotFound);
        }

        if (account.VoiceEnrollment is null)
        {
            return VoiceEnrollmentResult.Failure(VoiceEnrollmentFailureReason.NotEnrolled);
        }

        await accounts.UpdateAsync(account with { VoiceEnrollment = null }, cancellationToken);
        return VoiceEnrollmentResult.Success();
    }
}
