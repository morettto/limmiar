using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Api.Accounts;

/// <summary>
/// Real, self-contained TOTP implementation (RFC 6238 on top of RFC 4226's HOTP) -- no
/// external provider dependency, unlike <see cref="CouncilRegistryVerifier"/>. Uses the
/// universal defaults every authenticator app assumes: 30-second time step, 6 digits,
/// HMAC-SHA1.
/// </summary>
public sealed class TotpProvider : ITotpProvider
{
    private const int SecretLengthBytes = 20;
    private const int StepSeconds = 30;
    private const int Digits = 6;

    /// <summary>10^<see cref="Digits"/>, precomputed to avoid floating-point <see cref="Math.Pow"/>.</summary>
    private const int CodeModulus = 1_000_000;

    /// <summary>Tolerance on either side of the current time step, to absorb clock drift between server and device.</summary>
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

            // Not a secret-comparison timing concern the way the password verifier is
            // (S02-01) -- FixedTimeEquals is used here only for consistency with the rest
            // of this codebase's byte-comparison style, not because a timing side-channel
            // on a 6-digit, 30-second-lived code is a realistic threat.
            if (CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(candidate),
                    Encoding.ASCII.GetBytes(normalizedCode)))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// RFC 4226 section 5.3: HMAC-SHA1 over the big-endian 8-byte counter, then dynamic
    /// truncation into a <see cref="Digits"/>-digit decimal code.
    /// </summary>
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
