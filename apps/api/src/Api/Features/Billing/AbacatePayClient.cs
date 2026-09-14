using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Platform;

namespace Api.Billing;

/// <summary>
/// Molde <see cref="Result{TValue,TFailure}"/> (Platform/Result.cs). <c>Unavailable</c> é o
/// membro 0 de propósito: <c>default(Result&lt;Checkout, AbacatePayFailureReason&gt;)</c> lê
/// como esta falha, a mesma convenção de todo enum de falha de produção neste repositório.
/// </summary>
public enum AbacatePayFailureReason
{
    /// <summary>Rede/timeout (HttpRequestException/TaskCanceledException) ou 5xx.</summary>
    Unavailable,
    Unauthorized,
    NotFound,

    /// <summary>Restantes 4xx, ou 2xx com <c>success:false</c>/<c>data</c> nulo.</summary>
    RejectedByProvider,

    /// <summary>O corpo não parseia no contrato fixado -- o sinal de drift.</summary>
    MalformedResponse,
}

public sealed class AbacatePayClient
{
    /// <summary>
    /// O índice (llms.txt) anuncia /checkouts/one; a página do endpoint documenta
    /// /checkouts/get. Fixado /checkouts/get (a página manda) -- o primeiro caso do job de
    /// drift da fatia 9.
    /// </summary>
    public const string BaseUrl = "https://api.abacatepay.com/v2/";

    private readonly HttpClient _http;

    public AbacatePayClient(HttpClient http, string apiKey)
    {
        _http = http;
        _http.BaseAddress = new Uri(BaseUrl);
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
    }

    public Task<Result<Checkout, AbacatePayFailureReason>> CreateCheckoutAsync(
        CreateCheckoutRequest request, CancellationToken cancellationToken) =>
        SendAsync(
            () => _http.PostAsJsonAsync("checkouts/create", request, AbacatePayJsonContext.Default.CreateCheckoutRequest, cancellationToken),
            cancellationToken);

    public Task<Result<Checkout, AbacatePayFailureReason>> GetCheckoutAsync(
        string checkoutId, CancellationToken cancellationToken) =>
        SendAsync(
            () => _http.GetAsync($"checkouts/get?id={Uri.EscapeDataString(checkoutId)}", cancellationToken),
            cancellationToken);

    private static async Task<Result<Checkout, AbacatePayFailureReason>> SendAsync(
        Func<Task<HttpResponseMessage>> send, CancellationToken cancellationToken)
    {
        HttpResponseMessage response;
        try
        {
            response = await send();
        }
        catch (HttpRequestException)
        {
            return AbacatePayFailureReason.Unavailable;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return AbacatePayFailureReason.Unavailable;
        }

        using (response)
        {
            CheckoutEnvelope? envelope;
            try
            {
                envelope = await response.Content.ReadFromJsonAsync(AbacatePayJsonContext.Default.CheckoutEnvelope, cancellationToken);
            }
            catch (JsonException)
            {
                return AbacatePayFailureReason.MalformedResponse;
            }

            return MapResponse(response.StatusCode, envelope);
        }
    }

    /// <summary>O seam puro: deriva a falha a partir de status HTTP + envelope já desserializado, sem I/O.</summary>
    internal static Result<Checkout, AbacatePayFailureReason> MapResponse(HttpStatusCode status, CheckoutEnvelope? envelope)
    {
        if (envelope is null)
        {
            return AbacatePayFailureReason.MalformedResponse;
        }

        if (status == HttpStatusCode.Unauthorized)
        {
            return AbacatePayFailureReason.Unauthorized;
        }

        if (status == HttpStatusCode.NotFound)
        {
            return AbacatePayFailureReason.NotFound;
        }

        if ((int)status >= 500)
        {
            return AbacatePayFailureReason.Unavailable;
        }

        if (!envelope.Success || envelope.Data is null)
        {
            return AbacatePayFailureReason.RejectedByProvider;
        }

        return envelope.Data;
    }
}
