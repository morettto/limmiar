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

public enum PaymentStatus
{
    Pending,
    Paid,
    Refunded,
    Failed,
}

public enum RefundOutcome
{
    Refunded,
    NoPayment,
    AlreadyRefunded,
    ProviderHasNoRefund,
    RefundFailed,
}

/// <summary>O seam puro do dinheiro: deriva o estado interno a partir do status de fio já
/// desserializado, sem I/O. Expirado/cancelado viram Failed: sem sessão a cumprir nem
/// reembolso a pedir, só registo.</summary>
public static class AbacatePayMapper
{
    public static PaymentStatus ToPaymentStatus(CheckoutStatus status) => status switch
    {
        CheckoutStatus.Paid => PaymentStatus.Paid,
        CheckoutStatus.Refunded => PaymentStatus.Refunded,
        CheckoutStatus.Pending => PaymentStatus.Pending,
        _ => PaymentStatus.Failed,
    };
}

/// <summary>Envelope do webhook; <c>Data</c> nulo = evento sem payload confirmável.
/// Único leitor: <c>BillingEndpoints</c>, depois de <see cref="AbacatePayWebhookSignature.IsAuthentic"/>.</summary>
public sealed record AbacatePayWebhookEvent(string Id, string Event, int ApiVersion, bool DevMode, AbacateData? Data);

/// <summary>O <c>data</c> que S12-01 deixou por modelar: só o trio que a confirmação lê.
/// Desconhecidos (<c>externalId</c>, <c>url</c>, ...) são ignorados à desserialização.</summary>
public sealed record AbacateData(string Id, CheckoutStatus Status, int Amount);
