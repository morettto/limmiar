namespace Api.Audit;

/// <summary>The way a chain can stop being intact -- which check inside <see cref="AuditChain.Verify"/>
/// first failed. <see cref="HashMismatch"/> and <see cref="BrokenLink"/> come from the chain
/// walk itself; <see cref="AnchorMismatch"/> comes from an anchor contradicting a chain that
/// walked intact, which is the only evidence a fully recomputed rewrite leaves behind.</summary>
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
