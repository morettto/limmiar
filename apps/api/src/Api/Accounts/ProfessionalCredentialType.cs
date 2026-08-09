using System.Text.Json.Serialization;

namespace Api.Accounts;

/// <summary>
/// The three proof-of-credential paths a professional account can submit (Spec S02,
/// ADR-S02-05). <see cref="Crp"/> and <see cref="Crm"/> are auto-verified against
/// <see cref="ICouncilRegistryVerifier"/>; <see cref="Document"/> (psychoanalysts, who have
/// no regulatory council) always goes to human review instead.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<ProfessionalCredentialType>))]
public enum ProfessionalCredentialType
{
    /// <summary>Conselho Regional de Psicologia registration number.</summary>
    Crp,

    /// <summary>Conselho Regional de Medicina registration number.</summary>
    Crm,

    /// <summary>Upload of a training-completion document -- reviewed by a human, with SLA.</summary>
    Document,
}
