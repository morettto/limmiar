using System.Security.Cryptography;
using System.Text;

namespace Api.Billing;

/// <summary>
/// Verificação pura da assinatura do webhook (S12-01 fatia 4): HMAC-SHA256/base64 sobre os
/// bytes crus do corpo, mais o segredo de registo que viaja em query string. Zero I/O.
/// </summary>
public static class AbacatePayWebhookSignature
{
    /// <summary>
    /// Constante pública que a AbacatePay publica para verificar a assinatura de webhooks --
    /// NÃO é segredo (fica em claro no código-fonte de exemplo da documentação), logo não é
    /// configuração. Fonte: https://docs.abacatepay.com/pages/webhooks, exemplo Node
    /// <c>const ABACATEPAY_PUBLIC_KEY = "..."</c>, confirmado por leitura direta da página em
    /// 2026-09-08 (256 caracteres -- a forma aprovada estimava "~384 chars" antes de o valor
    /// real ser obtido; ver o relatório da dispatch da fatia 4 para essa divergência).
    /// </summary>
    public const string PublicKey =
        "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9";

    /// <summary>
    /// Verifica os dois: o HMAC-SHA256/base64 sobre <paramref name="rawBody"/> (header
    /// <c>X-Webhook-Signature</c>) e o segredo de registo (query <c>?webhookSecret=</c>).
    /// Ambas as comparações em tempo constante (<see cref="CryptographicOperations.FixedTimeEquals(ReadOnlySpan{byte}, ReadOnlySpan{byte})"/>),
    /// e ambas sempre calculadas -- nunca um curto-circuito que pule o cálculo de uma delas,
    /// para não vazar por tempo qual das duas falhou primeiro.
    /// </summary>
    public static bool IsAuthentic(
        ReadOnlySpan<byte> rawBody, string? signatureHeader, string? webhookSecretFromQuery, string expectedSecret)
    {
        var expectedSignature = Convert.ToBase64String(HMACSHA256.HashData(Encoding.UTF8.GetBytes(PublicKey), rawBody));

        var signatureMatches = CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expectedSignature), Encoding.UTF8.GetBytes(signatureHeader ?? string.Empty));
        var secretMatches = CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(webhookSecretFromQuery ?? string.Empty), Encoding.UTF8.GetBytes(expectedSecret));

        return signatureMatches && secretMatches;
    }
}
