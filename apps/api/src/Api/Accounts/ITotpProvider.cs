namespace Api.Accounts;

/// <summary>
/// TOTP (RFC 6238, built on RFC 4226's HOTP) secret generation, provisioning URI
/// construction, and code validation. Unlike <see cref="ICouncilRegistryVerifier"/>, TOTP is
/// a standard, self-contained algorithm with no external provider dependency -- the
/// production implementation (<see cref="TotpProvider"/>) is real and fully functional, not
/// a placeholder.
/// </summary>
public interface ITotpProvider
{
    /// <summary>A fresh, random Base32-encoded secret (RFC 4648 alphabet, no padding).</summary>
    string GenerateSecret();

    /// <summary>
    /// An <c>otpauth://totp/...</c> URI an authenticator app can import (typically via a
    /// QR code the caller renders from it -- this class does not render one itself).
    /// </summary>
    string BuildProvisioningUri(string secret, string accountEmail, string issuer);

    /// <summary>
    /// True if <paramref name="code"/> is a valid 6-digit TOTP code for
    /// <paramref name="secret"/> at <paramref name="timestamp"/>, tolerating +/-1 30-second
    /// step of clock drift between server and device.
    /// </summary>
    bool ValidateCode(string secret, string code, DateTimeOffset timestamp);
}
