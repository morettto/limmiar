namespace Api.Audit;

/// <summary>The way a chain can stop being intact -- which check inside <see cref="AuditChain.Verify"/>
/// first failed. <see cref="AnchorMismatch"/> is produced only once fatia 7 wires anchor
/// checking into <see cref="AuditChain.Verify"/>; this session (fatias 1-4) never returns it.</summary>
public enum AuditBreakKind
{
    HashMismatch,
    BrokenLink,
    AnchorMismatch,
}

/// <summary>Result of <see cref="AuditChain.Verify"/> -- molde de <c>SignNoteResult</c>
/// (Api.Notes): required flag plus optional detail fields, never a naked bool.</summary>
public sealed class AuditVerification
{
    public required bool Intact { get; init; }

    /// <summary>The first tampered sequence -- the "a partir daí" of acceptance criterion 1.</summary>
    public long? FirstBrokenSequence { get; init; }

    public AuditBreakKind? BreakKind { get; init; }

    public static AuditVerification Ok() => new() { Intact = true };

    public static AuditVerification Broken(long sequence, AuditBreakKind kind) =>
        new() { Intact = false, FirstBrokenSequence = sequence, BreakKind = kind };
}
