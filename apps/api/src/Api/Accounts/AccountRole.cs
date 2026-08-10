using System.Text.Json.Serialization;

namespace Api.Accounts;

[JsonConverter(typeof(JsonStringEnumConverter<AccountRole>))]
public enum AccountRole
{
    Professional,
    Patient,
}
