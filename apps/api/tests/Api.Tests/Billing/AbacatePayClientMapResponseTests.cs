using System.Net;
using Api.Billing;

namespace Api.Tests.Billing;

/// <summary>
/// AbacatePayClient.MapResponse é puro -- zero I/O -- então todo teste aqui corre sem
/// HttpClient nenhum. Os 7 casos são os da forma aprovada (.harness/S12-01-forma.md, fatia 1).
/// </summary>
public sealed class AbacatePayClientMapResponseTests
{
    private static readonly Checkout SampleCheckout =
        new("bill_abc123xyz", "pedido-123", "https://app.abacatepay.com/pay/bill_abc123xyz", 10000, CheckoutStatus.Pending);

    [Fact]
    public void MapResponse_200WithSuccessAndData_ReturnsCheckout()
    {
        var envelope = new CheckoutEnvelope(SampleCheckout, null, true);

        var result = AbacatePayClient.MapResponse(HttpStatusCode.OK, envelope);

        Assert.True(result.TryGetValue(out var checkout));
        Assert.Equal(SampleCheckout, checkout);
    }

    [Fact]
    public void MapResponse_401_ReturnsUnauthorized()
    {
        var envelope = new CheckoutEnvelope(null, "Token de autenticacao invalido ou ausente.", false);

        var result = AbacatePayClient.MapResponse(HttpStatusCode.Unauthorized, envelope);

        var reason = result.Match(_ => (AbacatePayFailureReason?)null, failure => failure);
        Assert.Equal(AbacatePayFailureReason.Unauthorized, reason);
    }

    [Fact]
    public void MapResponse_404_ReturnsNotFound()
    {
        var envelope = new CheckoutEnvelope(null, "Cobranca nao encontrada", false);

        var result = AbacatePayClient.MapResponse(HttpStatusCode.NotFound, envelope);

        var reason = result.Match(_ => (AbacatePayFailureReason?)null, failure => failure);
        Assert.Equal(AbacatePayFailureReason.NotFound, reason);
    }

    [Fact]
    public void MapResponse_5xx_ReturnsUnavailable()
    {
        var envelope = new CheckoutEnvelope(null, "internal error", false);

        var result = AbacatePayClient.MapResponse(HttpStatusCode.InternalServerError, envelope);

        var reason = result.Match(_ => (AbacatePayFailureReason?)null, failure => failure);
        Assert.Equal(AbacatePayFailureReason.Unavailable, reason);
    }

    [Fact]
    public void MapResponse_4xxWithSuccessFalse_ReturnsRejectedByProvider()
    {
        var envelope = new CheckoutEnvelope(null, "campo invalido", false);

        var result = AbacatePayClient.MapResponse(HttpStatusCode.UnprocessableEntity, envelope);

        var reason = result.Match(_ => (AbacatePayFailureReason?)null, failure => failure);
        Assert.Equal(AbacatePayFailureReason.RejectedByProvider, reason);
    }

    [Fact]
    public void MapResponse_200WithDataNull_ReturnsRejectedByProvider()
    {
        var envelope = new CheckoutEnvelope(null, null, true);

        var result = AbacatePayClient.MapResponse(HttpStatusCode.OK, envelope);

        var reason = result.Match(_ => (AbacatePayFailureReason?)null, failure => failure);
        Assert.Equal(AbacatePayFailureReason.RejectedByProvider, reason);
    }

    [Fact]
    public void MapResponse_EnvelopeNull_ReturnsMalformedResponse()
    {
        var result = AbacatePayClient.MapResponse(HttpStatusCode.OK, null);

        var reason = result.Match(_ => (AbacatePayFailureReason?)null, failure => failure);
        Assert.Equal(AbacatePayFailureReason.MalformedResponse, reason);
    }
}
