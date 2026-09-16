namespace Api.PatientLinks;

/// <summary>A confirmed 1:1 professional-patient link -- no team, no many-to-many.</summary>
public sealed record PatientLink(Guid ProfessionalAccountId, Guid PatientAccountId, Guid PatientId, DateTimeOffset LinkedAt);

/// <summary>A single-use invite the professional generates for one <see cref="PatientId"/> from her own carteira.</summary>
public sealed record LinkInvite(string Code, Guid ProfessionalAccountId, Guid PatientId, DateTimeOffset ExpiresAt);

/// <summary>An opaque item the patient shared with a professional -- the server sees only bytes, never a type or a plaintext.</summary>
public sealed record SharedItem(Guid ProfessionalAccountId, Guid PatientAccountId, DateTimeOffset SharedAt, byte[] Ciphertext);

/// <summary>An account's sharing-toggle state, opaque to the server: a DEK wrapped by the account's own KEK, plus the ciphertext it protects. <see cref="Version"/> is only an optimistic-concurrency counter, never interpreted.</summary>
public sealed record SharingPreferences(long Version, byte[] WrappedDek, byte[] Ciphertext);

/// <summary>
/// One patient the caller (a professional) was ever linked to, S11-03 fatia 10 -- one row per
/// <see cref="PatientAccountId"/> (the most recent <c>patient_links</c> row for that pair, active
/// or soft-unlinked), with every envelope ever shared along that pair, regardless of whether the
/// link that carried them is still active. <see cref="UnlinkedAt"/> null means the pair is still
/// linked; a non-null value is the moment the pair was undone, and the envelopes still appear.
/// </summary>
public sealed record ReceivedShare(
    Guid PatientAccountId, Guid PatientId, DateTimeOffset LinkedAt, DateTimeOffset? UnlinkedAt,
    byte[]? PeerPublicKey, IReadOnlyList<SharedItem> Items);
