using System.Linq;
using System.Text.Json;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Api.Billing;

public static class BillingEndpoints
{
    /// <summary>Confortavelmente acima de qualquer payload real da AbacatePay -- corta a
    /// leitura do corpo antes de chegar a IsAuthentic ou ao parse JSON.</summary>
    private const long MaxBodyBytes = 64 * 1024;

    public static void MapBillingEndpoints(this WebApplication app)
    {
        app.MapPost("/webhooks/abacatepay", HandleWebhookAsync)
            .WithName("PostAbacatePayWebhook")
            .WithSummary("Recetor de webhooks da AbacatePay")
            .WithDescription("Verifica X-Webhook-Signature (HMAC) e ?webhookSecret= contra o segredo configurado, depois regista o id do evento uma vez. Reentregas do mesmo id devolvem 200 duplicate:true, nunca 409 -- o fornecedor reentrega em qualquer resposta que não seja 2xx.")
            .Produces<WebhookAckResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized);
    }

    private static async Task<Results<Ok<WebhookAckResponse>, BadRequest, UnauthorizedHttpResult>> HandleWebhookAsync(
        HttpRequest request,
        AbacatePayWebhookSecret webhookSecret,
        AbacatePayWebhookStore store,
        CancellationToken cancellationToken)
    {
        var rawBody = await ReadBoundedBodyAsync(request, cancellationToken);
        if (rawBody is null)
        {
            return TypedResults.BadRequest();
        }

        var signatureHeader = request.Headers["X-Webhook-Signature"].FirstOrDefault();
        var webhookSecretFromQuery = request.Query["webhookSecret"].FirstOrDefault();

        if (!AbacatePayWebhookSignature.IsAuthentic(rawBody, signatureHeader, webhookSecretFromQuery, webhookSecret.Value))
        {
            return TypedResults.Unauthorized();
        }

        AbacatePayWebhookEvent? webhookEvent;
        try
        {
            webhookEvent = JsonSerializer.Deserialize(rawBody, AbacatePayJsonContext.Default.AbacatePayWebhookEvent);
        }
        catch (JsonException)
        {
            return TypedResults.BadRequest();
        }

        if (webhookEvent is null)
        {
            return TypedResults.BadRequest();
        }

        var isFirstSighting = await store.TryRecordAsync(webhookEvent.Id, webhookEvent.Event, cancellationToken);

        return TypedResults.Ok(new WebhookAckResponse(true, !isFirstSighting));
    }

    /// <summary>Lê o corpo até <c>MaxBodyBytes+1</c>: <c>null</c> quando passa do teto
    /// (o chamador responde 400), os bytes caso contrário. O teto antigo só olhava para
    /// <c>ContentLength</c>, que vem nulo em chunked -- aqui manda o que foi mesmo lido.</summary>
    internal static async Task<byte[]?> ReadBoundedBodyAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if ((request.ContentLength ?? 0) > MaxBodyBytes)
        {
            return null;
        }

        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int read;
        while ((read = await request.Body.ReadAsync(chunk, 0, chunk.Length, cancellationToken)) != 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > MaxBodyBytes)
            {
                return null;
            }
        }

        return buffer.ToArray();
    }
}

public sealed record WebhookAckResponse(bool Received, bool Duplicate);
