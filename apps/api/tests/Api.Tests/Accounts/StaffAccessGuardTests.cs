using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class StaffAccessGuardTests
{
    [Fact]
    public void IsAuthorized_WithCorrectApiKey_ReturnsTrue()
    {
        var guard = new StaffAccessGuard("correct-key");

        Assert.True(guard.IsAuthorized("correct-key"));
    }

    [Fact]
    public void IsAuthorized_WithWrongApiKey_ReturnsFalse()
    {
        var guard = new StaffAccessGuard("correct-key");

        Assert.False(guard.IsAuthorized("wrong-key"));
    }

    [Fact]
    public void IsAuthorized_WithNullApiKey_ReturnsFalse()
    {
        var guard = new StaffAccessGuard("correct-key");

        Assert.False(guard.IsAuthorized(null));
    }

    // Must not throw (FixedTimeEquals throws on mismatched span lengths if compared raw) and must not authorize.
    [Theory]
    [InlineData("short")]
    [InlineData("a-much-longer-candidate-than-the-real-key")]
    [InlineData("")]
    public void IsAuthorized_WithDifferentLengthApiKey_ReturnsFalse(string providedApiKey)
    {
        var guard = new StaffAccessGuard("correct-key");

        Assert.False(guard.IsAuthorized(providedApiKey));
    }
}
