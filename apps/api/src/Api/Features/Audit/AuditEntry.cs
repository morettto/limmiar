namespace Api.Audit;

/// <summary>
/// The closed set of events this trail records. Ordinal value is what
/// <see cref="AuditChain.ComputeHash"/> hashes (2 bytes, big-endian) and what the
/// <c>audit_action_range</c> CHECK constraint on <c>audit_entries</c> (migration
/// 0006) allows -- 0..5, kept in lockstep by
/// <c>AuditActionRangeMatchesEnum</c> (Api.Tests.Audit).
/// </summary>
public enum AuditAction
{
    SignIn,
    SignOut,
    RecordOpened,
    RecordAppended,
    NoteSigned,
    ExportRequested,
}

/// <summary>
/// One row of <c>audit_entries</c> (migration 0006_create_audit_trail.sql). Exactly the
/// seven metadata columns the migration allows -- no clinical content field exists to add
/// (acceptance criterion 4). <see cref="PreviousHash"/>/<see cref="EntryHash"/> are the
/// 32-byte SHA-256 outputs that chain this entry to the one before it, see
/// <see cref="AuditChain"/>.
/// </summary>
public sealed record AuditEntry(
    Guid TenantId,
    long Sequence,
    AuditAction Action,
    Guid DeviceId,
    DateTimeOffset RecordedAt,
    byte[] PreviousHash,
    byte[] EntryHash);

/// <summary>
/// A witness of the chain's head, captured into <c>audit_anchors</c> by
/// <see cref="AuditEntryStore.CaptureAnchorAsync"/> -- proves criterion 3 (full-chain rewrite
/// detection) against an attacker who rewrites <c>audit_entries</c> but not the separate
/// anchors table. Ceiling and upgrade path: see the ponytail comment in migration 0006.
/// </summary>
public sealed record AuditAnchor(
    Guid TenantId,
    long AnchoredSequence,
    byte[] AnchoredHash,
    DateTimeOffset AnchoredAt);
