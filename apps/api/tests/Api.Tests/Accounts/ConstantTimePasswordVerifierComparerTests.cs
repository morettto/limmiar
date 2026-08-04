using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class ConstantTimePasswordVerifierComparerTests
{
    [Fact]
    public void Matches_WithEqualByteArrays_ReturnsTrue()
    {
        var comparer = new ConstantTimePasswordVerifierComparer();
        var submitted = new byte[] { 1, 2, 3, 4 };
        var stored = new byte[] { 1, 2, 3, 4 };

        Assert.True(comparer.Matches(submitted, stored));
    }

    [Fact]
    public void Matches_WithDifferentByteArrays_ReturnsFalse()
    {
        var comparer = new ConstantTimePasswordVerifierComparer();
        var submitted = new byte[] { 1, 2, 3, 4 };
        var stored = new byte[] { 1, 2, 3, 9 };

        Assert.False(comparer.Matches(submitted, stored));
    }
}
