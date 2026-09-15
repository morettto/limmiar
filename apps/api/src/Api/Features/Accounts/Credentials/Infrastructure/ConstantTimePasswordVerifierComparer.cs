using System.Security.Cryptography;

namespace Api.Accounts;

public sealed class ConstantTimePasswordVerifierComparer : IPasswordVerifierComparer
{
    // `stored` is always SHA256(verifier) (see RegisterHandler, RegisterRecoveryVerifierHandler)
    // -- the verifier itself is never persisted. Re-hash what the client submits before the
    // constant-time comparison.
    public bool Matches(byte[] submitted, byte[] stored) =>
        CryptographicOperations.FixedTimeEquals(SHA256.HashData(submitted), stored);
}
