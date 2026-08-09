using System.Text;
using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// RFC 4648 section 10's Base32 test vectors (the padding character stripped, since this
/// implementation deliberately never pads -- see <see cref="Base32"/>'s own doc comment).
/// </summary>
public sealed class Base32Tests
{
    public static IEnumerable<object[]> RfcVectors() =>
        new[]
        {
            new object[] { "", "" },
            new object[] { "f", "MY" },
            new object[] { "fo", "MZXQ" },
            new object[] { "foo", "MZXW6" },
            new object[] { "foob", "MZXW6YQ" },
            new object[] { "fooba", "MZXW6YTB" },
            new object[] { "foobar", "MZXW6YTBOI" },
        };

    [Theory]
    [MemberData(nameof(RfcVectors))]
    public void Encode_WithRfc4648Vector_MatchesExpectedEncoding(string input, string expected)
    {
        var encoded = Base32.Encode(Encoding.ASCII.GetBytes(input));

        Assert.Equal(expected, encoded);
    }

    [Theory]
    [MemberData(nameof(RfcVectors))]
    public void Decode_WithRfc4648Vector_RoundTripsBackToOriginalBytes(string input, string encoded)
    {
        var decoded = Base32.Decode(encoded);

        Assert.Equal(Encoding.ASCII.GetBytes(input), decoded);
    }

    [Fact]
    public void Encode_WithEmptyArray_ReturnsEmptyString()
    {
        Assert.Equal(string.Empty, Base32.Encode([]));
    }

    [Fact]
    public void Decode_WithInvalidCharacter_ThrowsFormatException()
    {
        Assert.Throws<FormatException>(() => Base32.Decode("not-valid-base32!"));
    }

    [Fact]
    public void Decode_IsCaseInsensitive()
    {
        Assert.Equal(Base32.Decode("MZXW6YTB"), Base32.Decode("mzxw6ytb"));
    }
}
