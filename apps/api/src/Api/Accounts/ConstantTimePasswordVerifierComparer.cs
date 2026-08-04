using System.Security.Cryptography;

namespace Api.Accounts;

/// <summary>
/// Production <see cref="IPasswordVerifierComparer"/>. Delegates to
/// <see cref="CryptographicOperations.FixedTimeEquals"/>, the BCL's constant-time byte
/// comparison -- it takes the same time regardless of where (or whether) the arrays
/// differ, provided they're the same length. Equal length on every call is guaranteed by
/// <see cref="AccountService"/> (real verifiers and <see cref="AccountService.DummyVerifier"/>
/// are always exactly <see cref="AccountService.PasswordVerifierLength"/> bytes).
/// </summary>
public sealed class ConstantTimePasswordVerifierComparer : IPasswordVerifierComparer
{
    public bool Matches(byte[] submitted, byte[] stored) =>
        CryptographicOperations.FixedTimeEquals(submitted, stored);
}
