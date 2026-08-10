using System.Text.Json.Serialization;

namespace Api.Accounts;

[JsonConverter(typeof(JsonStringEnumConverter<AccountVerificationStatus>))]
public enum AccountVerificationStatus
{
    Pending,
    InReview,
    Active,
    Rejected,
}
