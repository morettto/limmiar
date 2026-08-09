using System.Text;

namespace Api.Accounts;

/// <summary>
/// RFC 4648 Base32 (alphabet "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), no padding -- not
/// available in the BCL (<see cref="Convert"/> only has Base64). Only used by
/// <see cref="TotpProvider"/> to encode/decode the TOTP secret.
/// </summary>
public static class Base32
{
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    public static string Encode(byte[] data)
    {
        if (data.Length == 0)
        {
            return string.Empty;
        }

        var result = new StringBuilder((data.Length * 8 + 4) / 5);
        var buffer = 0;
        var bitsLeft = 0;

        foreach (var b in data)
        {
            buffer = (buffer << 8) | b;
            bitsLeft += 8;

            while (bitsLeft >= 5)
            {
                bitsLeft -= 5;
                result.Append(Alphabet[(buffer >> bitsLeft) & 0x1F]);
            }
        }

        if (bitsLeft > 0)
        {
            // Pad the last partial group with low-order zero bits, same as any RFC 4648
            // Base32 encoder -- there is no padding character since callers never need to
            // concatenate encoded chunks.
            result.Append(Alphabet[(buffer << (5 - bitsLeft)) & 0x1F]);
        }

        return result.ToString();
    }

    public static byte[] Decode(string encoded)
    {
        var cleaned = encoded.Trim().TrimEnd('=').ToUpperInvariant();
        var bytes = new List<byte>((cleaned.Length * 5) / 8);
        var buffer = 0;
        var bitsLeft = 0;

        foreach (var c in cleaned)
        {
            var value = Alphabet.IndexOf(c);
            if (value < 0)
            {
                throw new FormatException($"'{c}' is not a valid Base32 character.");
            }

            buffer = (buffer << 5) | value;
            bitsLeft += 5;

            if (bitsLeft >= 8)
            {
                bitsLeft -= 8;
                bytes.Add((byte)((buffer >> bitsLeft) & 0xFF));
            }
        }

        return bytes.ToArray();
    }
}
