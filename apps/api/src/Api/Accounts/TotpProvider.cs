using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Api.Accounts;

public sealed class TotpProvider : ITotpProvider
{
    private const int SecretLengthBytes = 20;
    private const int StepSeconds = 30;
    private const int Digits = 6;

    private const int CodeModulus = 1_000_000;

    private const int ToleranceSteps = 1;

    public string GenerateSecret() => Base32.Encode(RandomNumberGenerator.GetBytes(SecretLengthBytes));

    public string BuildProvisioningUri(string secret, string accountEmail, string issuer)
    {
        var encodedIssuer = Uri.EscapeDataString(issuer);
        var encodedEmail = Uri.EscapeDataString(accountEmail);
        return $"otpauth://totp/{encodedIssuer}:{encodedEmail}?secret={secret}&issuer={encodedIssuer}&algorithm=SHA1&digits={Digits}&period={StepSeconds}";
    }

    public bool ValidateCode(string secret, string code, DateTimeOffset timestamp)
    {
        var normalizedCode = code.Trim();
        var secretBytes = Base32.Decode(secret);
        var currentStep = timestamp.ToUnixTimeSeconds() / StepSeconds;

        for (var drift = -ToleranceSteps; drift <= ToleranceSteps; drift++)
        {
            var counter = (ulong)(currentStep + drift);
            var candidate = ComputeHotp(secretBytes, counter);

            if (CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(candidate),
                    Encoding.ASCII.GetBytes(normalizedCode)))
            {
                return true;
            }
        }

        return false;
    }

    private static string ComputeHotp(byte[] secret, ulong counter)
    {
        var counterBytes = new byte[8];
        BinaryPrimitives.WriteUInt64BigEndian(counterBytes, counter);

        using var hmac = new HMACSHA1(secret);
        var hash = hmac.ComputeHash(counterBytes);

        var offset = hash[^1] & 0x0F;
        var truncated =
            ((hash[offset] & 0x7F) << 24) |
            ((hash[offset + 1] & 0xFF) << 16) |
            ((hash[offset + 2] & 0xFF) << 8) |
            (hash[offset + 3] & 0xFF);

        var code = (uint)truncated % CodeModulus;
        return code.ToString("D6");
    }
}
