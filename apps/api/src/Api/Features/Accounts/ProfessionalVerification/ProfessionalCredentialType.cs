using System.Text.Json.Serialization;

namespace Api.Accounts;

[JsonConverter(typeof(JsonStringEnumConverter<ProfessionalCredentialType>))]
public enum ProfessionalCredentialType
{
    Crp,
    Crm,
    Document,
}
