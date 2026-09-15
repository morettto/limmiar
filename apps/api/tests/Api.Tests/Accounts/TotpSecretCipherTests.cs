using System.Security.Cryptography;
using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class TotpSecretCipherTests
{
    private static readonly byte[] SomeKey = RandomNumberGenerator.GetBytes(32);

    [Fact]
    public void Encrypt_ThenDecrypt_RoundTripsTheSecret()
    {
        var cipher = new TotpSecretCipher(SomeKey);

        var encrypted = cipher.Encrypt("GENERATEDSECRETXYZ");
        var decrypted = cipher.Decrypt(encrypted);

        Assert.Equal("GENERATEDSECRETXYZ", decrypted);
    }

    [Fact]
    public void Encrypt_TwiceWithSameSecret_ProducesDifferentCiphertext()
    {
        // A random nonce per call -- otherwise the same secret always encrypts to the same
        // bytes, leaking equality information (two accounts sharing a TOTP secret would be
        // visible from a dump alone).
        var cipher = new TotpSecretCipher(SomeKey);

        var first = cipher.Encrypt("GENERATEDSECRETXYZ");
        var second = cipher.Encrypt("GENERATEDSECRETXYZ");

        Assert.NotEqual(first, second);
    }

    [Fact]
    public void Decrypt_WithTamperedCiphertext_ThrowsCryptographicException()
    {
        var cipher = new TotpSecretCipher(SomeKey);
        var encrypted = cipher.Encrypt("GENERATEDSECRETXYZ");
        encrypted[^1] ^= 0xFF;

        Assert.ThrowsAny<CryptographicException>(() => cipher.Decrypt(encrypted));
    }

    [Fact]
    public void Decrypt_WithWrongKey_ThrowsCryptographicException()
    {
        var cipher = new TotpSecretCipher(SomeKey);
        var encrypted = cipher.Encrypt("GENERATEDSECRETXYZ");
        var otherCipher = new TotpSecretCipher(RandomNumberGenerator.GetBytes(32));

        Assert.ThrowsAny<CryptographicException>(() => otherCipher.Decrypt(encrypted));
    }

    [Theory]
    [InlineData(16)]
    [InlineData(31)]
    [InlineData(33)]
    public void Constructor_WithKeyNotExactly32Bytes_ThrowsArgumentException(int keyLength)
    {
        var badKey = new byte[keyLength];

        Assert.Throws<ArgumentException>(() => new TotpSecretCipher(badKey));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(27)]
    public void Decrypt_WithBlobShorterThanNoncePlusTag_ThrowsArgumentException(int blobLength)
    {
        var cipher = new TotpSecretCipher(SomeKey);
        var tooShort = new byte[blobLength];

        Assert.Throws<ArgumentException>(() => cipher.Decrypt(tooShort));
    }
}
