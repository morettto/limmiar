using System.Security.Cryptography;

namespace Api.Accounts;

public sealed class ConstantTimePasswordVerifierComparer : IPasswordVerifierComparer
{
    public bool Matches(byte[] submitted, byte[] stored) =>
        CryptographicOperations.FixedTimeEquals(submitted, stored);
}
