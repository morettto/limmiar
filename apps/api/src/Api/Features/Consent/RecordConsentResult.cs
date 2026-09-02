namespace Api.Consent;

/// <summary>
/// Molde <see cref="Api.Notes.SignNoteResult"/> (ADR
/// docs/adr/ADR-api-store-service-boundary-result-contract.md): a store/service boundary
/// crossing into <c>ConsentService</c> returns this named result type, never a nullable tuple
/// nor a <c>!</c> across the boundary.
/// </summary>
public enum RecordConsentFailureReason
{
    AccountNotFound,
    NotAuthorizedToCreateRecords,
}

public sealed class RecordConsentResult
{
    public required bool Succeeded { get; init; }

    public ConsentEvent? Event { get; init; }

    public RecordConsentFailureReason? FailureReason { get; init; }

    public static RecordConsentResult Success(ConsentEvent evt) =>
        new() { Succeeded = true, Event = evt };

    public static RecordConsentResult Failure(RecordConsentFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
