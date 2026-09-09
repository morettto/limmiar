using Api.Platform;

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

    /// <summary>Distinguishes "unknown account" (AccountNotFound) from "account exists but never enrolled" (NotEnrolled) -- same symmetry as DeleteAsync, an unknown account is a normal not-found outcome here, not an exceptional one.</summary>
    public async Task<Result<VoiceEnrollment, VoiceEnrollmentFailureReason>> GetAsync(
        Guid accountId, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(accountId, cancellationToken);
        if (account is null) return VoiceEnrollmentFailureReason.AccountNotFound;
        if (account.VoiceEnrollment is null) return VoiceEnrollmentFailureReason.NotEnrolled;
        return account.VoiceEnrollment;
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
