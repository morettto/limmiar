using System.Security.Cryptography;
using System.Text;

namespace Api.Accounts;

public sealed class StaffAccessGuard : IStaffAccessGuard
{
    private readonly byte[] _expectedApiKeyHash;

    public StaffAccessGuard(string expectedApiKey)
    {
        _expectedApiKeyHash = SHA256.HashData(Encoding.UTF8.GetBytes(expectedApiKey));
    }

    public bool IsAuthorized(string? providedApiKey)
    {
        if (providedApiKey is null)
        {
            return false;
        }

        // Hash both sides to a fixed length first: FixedTimeEquals requires equal-length
        // inputs, and comparing raw lengths first would leak the expected key's length.
        var providedHash = SHA256.HashData(Encoding.UTF8.GetBytes(providedApiKey));
        return CryptographicOperations.FixedTimeEquals(providedHash, _expectedApiKeyHash);
    }
}
