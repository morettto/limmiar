namespace Api.Accounts;

/// <summary>The wrapped DEK and sealed embedding always travel together -- one field on Account instead of two, so the compiler (not a runtime invariant check) rules out "just one populated".</summary>
public sealed record VoiceEnrollment(byte[] WrappedDek, byte[] SealedEmbedding);

public enum VoiceEnrollmentFailureReason
{
    AccountNotFound,

    NotEnrolled,
}

public sealed class VoiceEnrollmentResult
{
    public required bool Succeeded { get; init; }

    public VoiceEnrollmentFailureReason? FailureReason { get; init; }

    public static VoiceEnrollmentResult Success() => new() { Succeeded = true };

    public static VoiceEnrollmentResult Failure(VoiceEnrollmentFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
