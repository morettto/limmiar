namespace Api.Accounts;

public sealed class WebAuthnAssertionResult
{
    public required bool Succeeded { get; init; }

    // Caller must persist this over the old stored sign count, or clone detection never has a fresh baseline.
    public uint? NewSignCount { get; init; }

    public WebAuthnCeremonyFailureReason? FailureReason { get; init; }

    public static WebAuthnAssertionResult Success(uint newSignCount) =>
        new() { Succeeded = true, NewSignCount = newSignCount };

    public static WebAuthnAssertionResult Failure(WebAuthnCeremonyFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
