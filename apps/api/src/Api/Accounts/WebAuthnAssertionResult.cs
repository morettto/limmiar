namespace Api.Accounts;

public sealed class WebAuthnAssertionResult
{
    public required bool Succeeded { get; init; }

    /// <summary>
    /// The counter value to write back over
    /// <see cref="WebAuthnAssertionCeremony.StoredSignCount"/> so the next assertion has a
    /// fresh baseline. Meaningless when <see cref="Succeeded"/> is false. Persisting it is
    /// what makes clone detection work at all -- a caller that verifies and then forgets to
    /// store this value has a verifier that can never notice a replay.
    /// </summary>
    public uint? NewSignCount { get; init; }

    public WebAuthnCeremonyFailureReason? FailureReason { get; init; }

    public static WebAuthnAssertionResult Success(uint newSignCount) =>
        new() { Succeeded = true, NewSignCount = newSignCount };

    public static WebAuthnAssertionResult Failure(WebAuthnCeremonyFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
