using System.Security.Cryptography;
using System.Text;

namespace Api.Accounts;

public static class BackupCodeGenerator
{
    private const int DefaultCount = 10;
    private const int RandomBytesPerCode = 5;

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

    public static string Hash(string code)
    {
        var normalized = code.Replace("-", string.Empty).ToLowerInvariant();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));
        return Convert.ToHexStringLower(hash);
    }
}
