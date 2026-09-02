namespace Api.Notes;

public enum SignNoteFailureReason
{
    AccountNotFound,
    NotAuthorizedToCreateRecords,
    AlreadySigned,
}

public sealed class SignNoteResult
{
    public required bool Succeeded { get; init; }

    public NoteSignature? Signature { get; init; }

    public SignNoteFailureReason? FailureReason { get; init; }

    public static SignNoteResult Success(NoteSignature signature) =>
        new() { Succeeded = true, Signature = signature };

    public static SignNoteResult Failure(SignNoteFailureReason reason) =>
        new() { Succeeded = false, FailureReason = reason };
}
