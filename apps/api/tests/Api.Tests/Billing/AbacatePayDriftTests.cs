using Api.Billing;

namespace Api.Tests.Billing;

/// <summary>
/// Sonda viva contra a sandbox AbacatePay (critério de aceite 2, fatia 9): prova que
/// /checkouts/get continua a rotear (o llms.txt anuncia /checkouts/one, a página do
/// endpoint documenta /checkouts/get) e que a resposta viva parseia sempre num
/// CheckoutStatus definido (MalformedResponse nunca). Sem ABACATEPAY_SANDBOX_API_KEY
/// retorna sem afirmar nada (passa em vazio, nunca falha): o workflow próprio só corre
/// a sonda com segredo, e o CI nunca a corre sem filtro de categoria.
/// </summary>
[Trait("Category", "Drift")]
public sealed class AbacatePayDriftTests
{
    [Fact]
    public async Task LiveSandbox_CreateThenGetCheckout_RoutesAndParsesInDefinedStatus()
    {
        var apiKey = Environment.GetEnvironmentVariable("ABACATEPAY_SANDBOX_API_KEY");
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return; // Sem segredo: salta por retorno, não falha. O porquê vai no summary do workflow.
        }

        using var http = new HttpClient();
        var client = new AbacatePayClient(http, apiKey);

        var created = await client.CreateCheckoutAsync(
            new([new CheckoutItem("prod_drift_probe", 1)], ["PIX"], null, null, null),
            CancellationToken.None);
        var createReason = created.Match(_ => (AbacatePayFailureReason?)null, failure => failure);
        Assert.True(created.TryGetValue(out var checkout), $"CreateCheckout na sandbox falhou: {createReason} (MalformedResponse = drift).");
        Assert.True(Enum.IsDefined(checkout!.Status), $"Status vivo fora do contrato: {(int)checkout.Status}.");

        var fetched = await client.GetCheckoutAsync(checkout.Id, CancellationToken.None);
        var getReason = fetched.Match(_ => (AbacatePayFailureReason?)null, failure => failure);
        Assert.True(fetched.TryGetValue(out var live), $"/checkouts/get não roteou ou deriva: {getReason} (MalformedResponse = drift).");
        Assert.True(Enum.IsDefined(live!.Status), $"Status vivo fora do contrato: {(int)live.Status}.");
    }
}
