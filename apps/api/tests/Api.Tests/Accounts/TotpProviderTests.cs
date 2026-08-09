using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// RFC 4226 Appendix D known-answer vectors (the HOTP algorithm TOTP is built on top of).
/// The RFC's test secret is the 20 ASCII bytes "12345678901234567890"; since
/// <see cref="ITotpProvider"/> only accepts a Base32 secret, this test Base32-encodes it
/// once via <see cref="Base32"/> itself before exercising <see cref="TotpProvider.ValidateCode"/>
/// through a <see cref="DateTimeOffset"/> chosen so <c>unixtime/30</c> lands exactly on the
/// desired counter.
/// </summary>
public sealed class TotpProviderTests
{
    // RFC 4226 Appendix D: HOTP(secret, counter) for counter 0..9.
    private static readonly (int Counter, string ExpectedCode)[] KnownAnswers =
    [
        (0, "755224"),
        (1, "287082"),
        (2, "359152"),
        (3, "969429"),
        (4, "338314"),
        (5, "254676"),
        (6, "287922"),
        (7, "162583"),
        (8, "399871"),
        (9, "520489"),
    ];

    private static readonly string RfcSecretBase32 = Base32.Encode(System.Text.Encoding.ASCII.GetBytes("12345678901234567890"));

    public static IEnumerable<object[]> KnownAnswerCases() =>
        KnownAnswers.Select(pair => new object[] { pair.Counter, pair.ExpectedCode });

    [Theory]
    [MemberData(nameof(KnownAnswerCases))]
    public void ValidateCode_WithRfc4226KnownAnswerVector_ReturnsTrue(int counter, string expectedCode)
    {
        var provider = new TotpProvider();
        var timestamp = TimestampForCounter(counter);

        Assert.True(provider.ValidateCode(RfcSecretBase32, expectedCode, timestamp));
    }

    [Fact]
    public void ValidateCode_WithWrongCode_ReturnsFalse()
    {
        var provider = new TotpProvider();
        var timestamp = TimestampForCounter(1);

        Assert.False(provider.ValidateCode(RfcSecretBase32, "000000", timestamp));
    }

    /// <summary>
    /// Counter 5 is four steps (120s) away from counter 1 -- well outside the +/-1 step
    /// tolerance window -- so counter 1's code must not validate against counter 5's timestamp.
    /// </summary>
    [Fact]
    public void ValidateCode_OutsideToleranceWindow_ReturnsFalse()
    {
        var provider = new TotpProvider();
        var farTimestamp = TimestampForCounter(5);

        Assert.False(provider.ValidateCode(RfcSecretBase32, "287082", farTimestamp));
    }

    /// <summary>
    /// One step (30s) of clock drift on either side must still validate -- this is exactly
    /// what the tolerance window exists for.
    /// </summary>
    [Theory]
    [InlineData(-1)]
    [InlineData(1)]
    public void ValidateCode_OneStepOfClockDrift_StillReturnsTrue(int stepOffset)
    {
        var provider = new TotpProvider();
        // Counter 5's code, checked against a timestamp landing on an adjacent counter.
        var driftedTimestamp = TimestampForCounter(5 + stepOffset);

        Assert.True(provider.ValidateCode(RfcSecretBase32, "254676", driftedTimestamp));
    }

    [Fact]
    public void GenerateSecret_ReturnsDifferentSecretsEachTime()
    {
        var provider = new TotpProvider();

        var first = provider.GenerateSecret();
        var second = provider.GenerateSecret();

        Assert.NotEqual(first, second);
        Assert.Matches("^[A-Z2-7]+$", first);
    }

    [Fact]
    public void BuildProvisioningUri_EscapesFreeTextAndIncludesExpectedParameters()
    {
        var provider = new TotpProvider();

        var uri = provider.BuildProvisioningUri("JBSWY3DPEHPK3PXP", "user@example.com", "Limmiar");

        Assert.StartsWith("otpauth://totp/Limmiar:user%40example.com?", uri);
        Assert.Contains("secret=JBSWY3DPEHPK3PXP", uri);
        Assert.Contains("issuer=Limmiar", uri);
        Assert.Contains("algorithm=SHA1", uri);
        Assert.Contains("digits=6", uri);
        Assert.Contains("period=30", uri);
    }

    /// <summary>
    /// Chooses a <see cref="DateTimeOffset"/> whose <c>unixtime/30</c> (truncated) equals
    /// exactly <paramref name="counter"/> -- picks the first second of that 30-second step.
    /// </summary>
    private static DateTimeOffset TimestampForCounter(int counter) =>
        DateTimeOffset.FromUnixTimeSeconds(counter * 30L);
}
