using System.Text.Json.Serialization;

namespace Api.Accounts;

[JsonConverter(typeof(JsonStringEnumConverter<MagicLinkCeremonyType>))]
public enum MagicLinkCeremonyType
{
    Register,
    Assert,
}

public sealed record MagicLinkTicketData(
    string Email,
    MagicLinkCeremonyType CeremonyType,
    byte[] Challenge,
    Guid? AccountId = null,
    byte[]? CredentialId = null,
    byte[]? StoredCosePublicKey = null,
    uint? StoredSignCount = null);
