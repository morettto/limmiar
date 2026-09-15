using System.Security.Cryptography;
using System.Text;

namespace Api.Accounts;

/// <summary>
/// AES-256-GCM envelope for <c>accounts.totp_secret_encrypted</c> (S11-03, endurecimento):
/// the raw TOTP secret (a Base32 string, <see cref="TotpProvider.GenerateSecret"/>) never
/// touches Postgres in the clear. The key comes from application configuration
/// (<c>Totp:EncryptionKey</c>, see <see cref="TwoFactorComposition.AddTwoFactor"/>), never
/// hardcoded, and startup fails closed if it is missing or the wrong size. Business logic
/// (TotpProvider, the TwoFactor handlers) never sees this type -- only
/// <see cref="Api.Accounts.PostgresAccountStore"/> encrypts/decrypts at the persistence
/// boundary, so a dump of the accounts table alone cannot recover a TOTP secret.
/// </summary>
public sealed class TotpSecretCipher
{
    private const int KeyLengthBytes = 32;
    private const int NonceLengthBytes = 12;
    private const int TagLengthBytes = 16;

    private readonly byte[] _key;

    public TotpSecretCipher(byte[] key)
    {
        if (key.Length != KeyLengthBytes)
        {
            throw new ArgumentException($"TOTP encryption key must be exactly {KeyLengthBytes} bytes, got {key.Length}.", nameof(key));
        }

        _key = key;
    }

    /// <summary>Layout: nonce (12 bytes) || ciphertext (same length as plaintext) || tag (16 bytes) -- one self-contained blob per encryption, a fresh random nonce every call.</summary>
    public byte[] Encrypt(string plaintextSecret)
    {
        var plaintextBytes = Encoding.ASCII.GetBytes(plaintextSecret);
        var nonce = RandomNumberGenerator.GetBytes(NonceLengthBytes);
        var ciphertext = new byte[plaintextBytes.Length];
        var tag = new byte[TagLengthBytes];

        using var aesGcm = new AesGcm(_key, TagLengthBytes);
        aesGcm.Encrypt(nonce, plaintextBytes, ciphertext, tag);

        var result = new byte[NonceLengthBytes + ciphertext.Length + TagLengthBytes];
        nonce.CopyTo(result, 0);
        ciphertext.CopyTo(result, NonceLengthBytes);
        tag.CopyTo(result, NonceLengthBytes + ciphertext.Length);
        return result;
    }

    public string Decrypt(byte[] encrypted)
    {
        var nonce = encrypted.AsSpan(0, NonceLengthBytes);
        var ciphertext = encrypted.AsSpan(NonceLengthBytes, encrypted.Length - NonceLengthBytes - TagLengthBytes);
        var tag = encrypted.AsSpan(encrypted.Length - TagLengthBytes, TagLengthBytes);

        var plaintextBytes = new byte[ciphertext.Length];
        using var aesGcm = new AesGcm(_key, TagLengthBytes);
        aesGcm.Decrypt(nonce, ciphertext, tag, plaintextBytes);

        return Encoding.ASCII.GetString(plaintextBytes);
    }
}
