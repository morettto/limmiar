using Api.Platform;

namespace Api.Accounts;

public sealed class VoiceEnrollmentService(IAccountStore accounts)
{
    public async Task<VoiceEnrollmentFailureReason?> EnrollAsync(
        Guid accountId, byte[] wrappedDek, byte[] sealedEmbedding, CancellationToken cancellationToken)
    {
        var account = await accounts.MutateAsync(accountId,
            current => current with { VoiceEnrollment = new VoiceEnrollment(wrappedDek, sealedEmbedding) },
            cancellationToken);
        return account is null ? VoiceEnrollmentFailureReason.AccountNotFound : null;
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

    public async Task<VoiceEnrollmentFailureReason?> DeleteAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var account = await accounts.FindByIdAsync(accountId, cancellationToken);
        if (account is null)
        {
            return VoiceEnrollmentFailureReason.AccountNotFound;
        }

        if (account.VoiceEnrollment is null)
        {
            return VoiceEnrollmentFailureReason.NotEnrolled;
        }

        var updated = await accounts.MutateAsync(accountId,
            current => current.VoiceEnrollment is null ? null : current with { VoiceEnrollment = null }, cancellationToken);
        return updated is null ? VoiceEnrollmentFailureReason.NotEnrolled : null;
    }
}
