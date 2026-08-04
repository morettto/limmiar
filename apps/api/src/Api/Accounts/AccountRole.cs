using System.Text.Json.Serialization;

namespace Api.Accounts;

/// <summary>
/// The two account kinds this product supports (Spec S02 · Identidade e acesso). Chosen
/// by the caller via the segmented control on screen A1 (ADR-S02-01) for e-mail
/// registration, or resolved automatically by <see cref="AccountService.GoogleAuthAsync"/>
/// when signing in with Google against an e-mail that already has an account.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<AccountRole>))]
public enum AccountRole
{
    Professional,
    Patient,
}
