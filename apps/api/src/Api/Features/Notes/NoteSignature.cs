namespace Api.Notes;

/// <summary>
/// One row of <c>note_signatures</c> -- the primary key (TenantId, NoteId) is what guarantees
/// exactly one signature per note, forever (see migration 0005's comments). <see cref="Signature"/>
/// is opaque to the server: <c>iv(12) || AES-GCM(digest SHA-256 da nota)(32) || tag(16)</c>, 60 bytes.
/// </summary>
public sealed record NoteSignature(Guid TenantId, Guid NoteId, int Revision, byte[] Signature, DateTimeOffset SignedAt);
