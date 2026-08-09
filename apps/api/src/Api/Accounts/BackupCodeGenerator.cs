using System.Security.Cryptography;
using System.Text;

namespace Api.Accounts;

/// <summary>
/// Single-use TOTP backup codes for account recovery (ADR-S02-04): the only way to regain
/// access to a Professional account that has lost its authenticator device, since there is
/// deliberately no support-side 2FA reset/disable endpoint. Pure and stateless -- no
/// interface/DI seam needed, tests call it directly.
/// </summary>
public static class BackupCodeGenerator
{
    private const int DefaultCount = 10;
    private const int RandomBytesPerCode = 5;

    /// <summary>
    /// <paramref name="count"/> unique codes, each formatted "xxxxx-xxxxx" (10 lowercase hex
    /// characters split by a hyphen for readability). Uniqueness is actively checked rather
    /// than just assumed from randomness -- a collision is astronomically unlikely at 40
    /// bits of entropy per code, but a duplicate backup code would be a real security bug,
    /// not merely cosmetic.
    /// </summary>
    public static IReadOnlyList<string> GenerateCodes(int count = DefaultCount)
    {
        var codes = new HashSet<string>(StringComparer.Ordinal);
        while (codes.Count < count)
        {
            var raw = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(RandomBytesPerCode));
            codes.Add($"{raw[..5]}-{raw[5..]}");
        }

        return codes.ToList();
    }

    /// <summary>
    /// SHA-256 hex hash of <paramref name="code"/>, after stripping hyphens and
    /// lowercasing -- so a user who types the code without the hyphen, or in upper case,
    /// still hashes to the same stored value.
    /// </summary>
    public static string Hash(string code)
    {
        var normalized = code.Replace("-", string.Empty).ToLowerInvariant();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));
        return Convert.ToHexStringLower(hash);
    }
}
