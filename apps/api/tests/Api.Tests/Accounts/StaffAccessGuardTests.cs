using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Covers <see cref="StaffAccessGuard"/> directly -- see its own doc comment and
/// <see cref="IStaffAccessGuard"/>'s for why this is a shared-secret stopgap, not real RBAC.
/// </summary>
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

    /// <summary>
    /// A shorter/longer candidate must not throw (CryptographicOperations.FixedTimeEquals
    /// would throw on mismatched span lengths if the keys were compared raw) and must not
    /// authorize.
    /// </summary>
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
