using System.Security.Cryptography;
using System.Text;
using Api.Billing;

namespace Api.Tests.Billing;

/// <summary>
/// AbacatePayWebhookSignature.IsAuthentic é pura -- zero I/O -- sobre os bytes crus da
/// fixture webhook-checkout-completed.json (forma S12-01, fatia 4). O HMAC esperado é
/// calculado aqui de forma independente da implementação, com a mesma chave pública
/// publicada, exatamente como o fornecedor faz do lado dele.
/// </summary>
public sealed class AbacatePayWebhookSignatureTests
{
    private const string ExpectedSecret = "whsec_test123";

    private static readonly byte[] RawBody = AbacatePayFixtures.ReadBytes("webhook-checkout-completed.json");

    private static string ValidSignature(byte[] body) =>
        Convert.ToBase64String(HMACSHA256.HashData(Encoding.UTF8.GetBytes(AbacatePayWebhookSignature.PublicKey), body));

    [Fact]
    public void ParValido_ReturnsTrue()
    {
        var authentic = AbacatePayWebhookSignature.IsAuthentic(RawBody, ValidSignature(RawBody), ExpectedSecret, ExpectedSecret);

        Assert.True(authentic);
    }

    [Fact]
    public void HeaderAusente_ReturnsFalse()
    {
        var authentic = AbacatePayWebhookSignature.IsAuthentic(RawBody, null, ExpectedSecret, ExpectedSecret);

        Assert.False(authentic);
    }

    [Fact]
    public void HeaderErrado_ReturnsFalse()
    {
        var authentic = AbacatePayWebhookSignature.IsAuthentic(RawBody, "wrong-signature-not-base64-hmac", ExpectedSecret, ExpectedSecret);

        Assert.False(authentic);
    }

    [Fact]
    public void SegredoErrado_ReturnsFalse()
    {
        var authentic = AbacatePayWebhookSignature.IsAuthentic(RawBody, ValidSignature(RawBody), "different-secret", ExpectedSecret);

        Assert.False(authentic);
    }

    [Fact]
    public void SegredoAusente_ReturnsFalse()
    {
        var authentic = AbacatePayWebhookSignature.IsAuthentic(RawBody, ValidSignature(RawBody), null, ExpectedSecret);

        Assert.False(authentic);
    }

    [Fact]
    public void UmByteDoCorpoAlterado_ReturnsFalse()
    {
        var tamperedBody = (byte[])RawBody.Clone();
        tamperedBody[0] ^= 0xFF;

        var authentic = AbacatePayWebhookSignature.IsAuthentic(tamperedBody, ValidSignature(RawBody), ExpectedSecret, ExpectedSecret);

        Assert.False(authentic);
    }
}
