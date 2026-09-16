using System.Security.Cryptography;
using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class ConstantTimePasswordVerifierComparerTests
{
    // Stored is always SHA256(verifier), never the verifier itself -- see RegisterHandler and
    // RegisterRecoveryVerifierHandler, which are the only two writers. The comparer's job is to
    // re-hash what the client submits before comparing, so it must NOT match a byte-for-byte
    // equal "stored" that is not actually a hash.
    [Fact]
    public void Matches_WhenStoredIsSha256OfSubmitted_ReturnsTrue()
    {
        var comparer = new ConstantTimePasswordVerifierComparer();
        var submitted = new byte[] { 1, 2, 3, 4 };
        var stored = SHA256.HashData(submitted);

        Assert.True(comparer.Matches(submitted, stored));
    }

    [Fact]
    public void Matches_WhenStoredIsNotSha256OfSubmitted_ReturnsFalse()
    {
        var comparer = new ConstantTimePasswordVerifierComparer();
        var submitted = new byte[] { 1, 2, 3, 4 };
        var stored = SHA256.HashData(new byte[] { 1, 2, 3, 9 });

        Assert.False(comparer.Matches(submitted, stored));
    }

    [Fact]
    public void Matches_WithSubmittedEqualToStored_ReturnsFalse()
    {
        // Regression: before hashing was introduced, equal byte arrays used to match. A raw
        // verifier is never a valid SHA-256 of itself, so this must fail closed.
        var comparer = new ConstantTimePasswordVerifierComparer();
        var submitted = new byte[] { 1, 2, 3, 4 };
        var stored = new byte[] { 1, 2, 3, 4 };

        Assert.False(comparer.Matches(submitted, stored));
    }
}
