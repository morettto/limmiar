using System.Text.Json.Serialization;

namespace Api.Billing;

/// <summary>
/// O segredo de registo do webhook (query <c>?webhookSecret=</c>) -- não é a chave pública de
/// assinatura (<see cref="AbacatePayWebhookSignature.PublicKey"/>, essa não é segredo). Um
/// record próprio, não uma <c>string</c> nua, para que o container de DI resolva um único tipo
/// inequívoco (molde <c>ConsentComposition.cs</c> não tem parâmetro simples equivalente, mas
/// evita colidir por acidente com qualquer outra <c>string</c> registada).
/// </summary>
public sealed record AbacatePayWebhookSecret(string Value);

public static class BillingComposition
{
    /// <summary>
    /// Molde de leitura obrigatória <c>Program.cs:36-37</c> (falha rápida por
    /// <see cref="InvalidOperationException"/>, sem Options pattern) -- não o molde
    /// <c>ConsentComposition.AddConsent</c>, que não recebe <see cref="IConfiguration"/>
    /// porque não tem nenhuma chave obrigatória própria.
    /// </summary>
    public static void AddBilling(this IServiceCollection services, IConfiguration configuration)
    {
        var webhookSecret = configuration["AbacatePay:WebhookSecret"]
            ?? throw new InvalidOperationException("Missing required configuration: AbacatePay:WebhookSecret");

        var apiKey = configuration["AbacatePay:ApiKey"]
            ?? throw new InvalidOperationException("Missing required configuration: AbacatePay:ApiKey");

        services.AddSingleton(new AbacatePayWebhookSecret(webhookSecret));
        services.AddSingleton<AbacatePayWebhookStore>();
        services.AddSingleton<IPublicLinkStore, PublicLinkStore>();
        services.AddSingleton<IBookingPaymentStore, BookingPaymentStore>();
        services.AddTransient<IPublicBooking, PublicBookingService>();

        // Cliente tipado: AddTypedClient é a fábrica sem Options nem reflexão no arranque.
        // Transiente por IAbacatePayClient (tipo explícito) -- senão o HttpMessageHandler
        // fica captivo e o DNS nunca refresca.
        services.AddHttpClient<IAbacatePayClient>().AddTypedClient<IAbacatePayClient>((http, _) => new AbacatePayClient(http, apiKey));

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, AbacatePayJsonContext.Default);
        });
    }

    public static void MapBilling(this IEndpointRouteBuilder app)
    {
        app.MapBillingEndpoints();
        app.MapPublicBookingEndpoints();
    }
}

/// <summary>
/// [JsonStringEnumMemberName] no próprio <see cref="CheckoutStatus"/> mais
/// UseStringEnumConverter aqui resolve "PENDING"/"PAID"/etc. inteiramente por source-gen --
/// sem <c>JsonSerializerOptions</c> em runtime, sem risco IL3050. Um valor de status
/// desconhecido no fio vira <c>JsonException</c> (sem membro de fallback), que é o sinal de
/// drift que a fatia 9 vigia.
/// </summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, UseStringEnumConverter = true)]
[JsonSerializable(typeof(CreateCheckoutRequest))]
[JsonSerializable(typeof(CheckoutEnvelope))]
[JsonSerializable(typeof(AbacatePayWebhookEvent))]
[JsonSerializable(typeof(AbacateData))]
[JsonSerializable(typeof(WebhookAckResponse))]
[JsonSerializable(typeof(PublicReserveRequest))]
[JsonSerializable(typeof(PublicReserveResponse))]
[JsonSerializable(typeof(NoShowResponse))]
public partial class AbacatePayJsonContext : JsonSerializerContext
{
}
