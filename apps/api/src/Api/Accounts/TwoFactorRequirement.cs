using System.Text.Json.Serialization;

namespace Api.Accounts;

[JsonConverter(typeof(JsonStringEnumConverter<TwoFactorRequirement>))]
public enum TwoFactorRequirement
{
    NotApplicable,
    SetupRequired,
    ChallengeRequired,
}
