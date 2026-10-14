using System.Text.Json.Serialization;

namespace Api.Accounts;

[JsonConverter(typeof(JsonStringEnumConverter<MagicLinkCeremonyType>))]
public enum MagicLinkCeremonyType
{
    Register,
    Assert,
}

public sealed record MagicLinkTicketData(
    PatientAccessInvitation Invitation,
    MagicLinkCeremonyType CeremonyType,
    byte[] Challenge,
    Guid AccountId,
    byte[]? CredentialId = null,
    byte[]? StoredCosePublicKey = null,
    uint? StoredSignCount = null);
