using System.Security.Cryptography;
using System.Text;

namespace Api.Accounts;

/// <summary>
/// See <see cref="IStaffAccessGuard"/> -- a shared-secret stopgap, not real RBAC.
/// </summary>
public sealed class StaffAccessGuard : IStaffAccessGuard
{
    private readonly byte[] _expectedApiKeyHash;

    public StaffAccessGuard(string expectedApiKey)
    {
        _expectedApiKeyHash = SHA256.HashData(Encoding.UTF8.GetBytes(expectedApiKey));
    }

    /// <summary>
    /// <see cref="CryptographicOperations.FixedTimeEquals"/> throws if the two spans have
    /// different lengths, and a raw UTF-8-length comparison first would leak the expected
    /// key's length through timing. Both sides are hashed to a fixed-length SHA-256 digest
    /// first, so the comparison is always same-length and constant-time regardless of the
    /// provided key's length.
    /// </summary>
    public bool IsAuthorized(string? providedApiKey)
    {
        if (providedApiKey is null)
        {
            return false;
        }

        var providedHash = SHA256.HashData(Encoding.UTF8.GetBytes(providedApiKey));
        return CryptographicOperations.FixedTimeEquals(providedHash, _expectedApiKeyHash);
    }
}
