using System.Text.Json.Serialization;

namespace Api.Billing;

public sealed record CheckoutItem(string Id, int Quantity);

public sealed record CreateCheckoutRequest(
    IReadOnlyList<CheckoutItem> Items,
    IReadOnlyList<string> Methods,
    string? ExternalId,
    string? ReturnUrl,
    string? CompletionUrl);

/// <summary>
/// Enum fechado do contrato AbacatePay (fonte: docs.abacatepay.com/pages/payment/create,
/// confirmado em apps/api/tests/Api.Tests/Billing/fixtures). Um valor de fio desconhecido
/// falha a desserialização (<see cref="JsonStringEnumMemberNameAttribute"/> sem fallback) --
/// é exatamente esse <c>JsonException</c> que vira <c>MalformedResponse</c>, o sinal de
/// drift que o job de S12-01 fatia 9 vigia.
/// </summary>
public enum CheckoutStatus
{
    [JsonStringEnumMemberName("PENDING")] Pending,
    [JsonStringEnumMemberName("EXPIRED")] Expired,
    [JsonStringEnumMemberName("CANCELLED")] Cancelled,
    [JsonStringEnumMemberName("PAID")] Paid,
    [JsonStringEnumMemberName("REFUNDED")] Refunded,
}

public sealed record Checkout(string Id, string? ExternalId, string Url, int Amount, CheckoutStatus Status);

/// <summary>Envelope de todas as rotas HTTP. Não genérico: há um só payload (Checkout) neste ticket.</summary>
public sealed record CheckoutEnvelope(Checkout? Data, string? Error, bool Success);

/// <summary>
/// Envelope do webhook. Sem <c>data</c>: a página por evento da documentação nunca foi
/// alcançada (404 -- ver handoff S12-01), e fixar um <c>data</c> assumido violaria o critério
/// de aceite 1. <c>BillingEndpoints</c> (fatia 7) é o único leitor -- é ele quem desserializa
/// isto do corpo cru do pedido, depois de <see cref="AbacatePayWebhookSignature.IsAuthentic"/>.
/// </summary>
public sealed record AbacatePayWebhookEvent(string Id, string Event, int ApiVersion, bool DevMode);
