namespace Api.PatientLinks;

/// <summary>A confirmed 1:1 professional-patient link -- no team, no many-to-many.</summary>
public sealed record PatientLink(Guid ProfessionalAccountId, Guid PatientAccountId, Guid PatientId, DateTimeOffset LinkedAt);

/// <summary>A single-use invite the professional generates for one <see cref="PatientId"/> from her own carteira.</summary>
public sealed record LinkInvite(string Code, Guid ProfessionalAccountId, Guid PatientId, DateTimeOffset ExpiresAt);
