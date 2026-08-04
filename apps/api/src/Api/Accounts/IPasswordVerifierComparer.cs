namespace Api.Accounts;

/// <summary>
/// Compares a client-submitted password verifier against a stored one. The production
/// implementation (<see cref="ConstantTimePasswordVerifierComparer"/>) must take the same
/// time whether the two arrays match or not -- see <see cref="AccountService.LoginAsync"/>
/// for why this matters (account enumeration mitigation, S02-01 acceptance criterion).
/// </summary>
public interface IPasswordVerifierComparer
{
    bool Matches(byte[] submitted, byte[] stored);
}
