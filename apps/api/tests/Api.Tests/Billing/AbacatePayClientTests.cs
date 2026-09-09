using System.Net;
using System.Net.Http.Headers;
using Api.Billing;

namespace Api.Tests.Billing;

/// <summary>
/// AbacatePayClient sobre CannedResponseHandler -- zero rede real, zero Testcontainers.
/// Cobre o seam do HttpClient (forma S12-01, secção 4/fatia 3).
/// </summary>
public sealed class AbacatePayClientTests
{
    private static readonly CreateCheckoutRequest SampleRequest =
        new([new CheckoutItem("prod_abc123xyz", 1)], ["PIX"], "pedido-123", null, null);

    [Fact]
    public async Task CreateCheckoutAsync_SendsAbsoluteUrlWithBearerAuthAndSerializedBody()
    {
        var handler = new CannedResponseHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(AbacatePayFixtures.ReadBytes("checkout-create-200.json")),
        });
        var client = new AbacatePayClient(new HttpClient(handler), "abc_test_key");

        var result = await client.CreateCheckoutAsync(SampleRequest, CancellationToken.None);

        Assert.True(result.TryGetValue(out _));
        Assert.NotNull(handler.LastRequest);
        Assert.True(handler.LastRequest!.RequestUri!.IsAbsoluteUri);
        Assert.Equal("https://api.abacatepay.com/v2/checkouts/create", handler.LastRequest.RequestUri!.ToString());
        Assert.Equal(new AuthenticationHeaderValue("Bearer", "abc_test_key"), handler.LastRequest.Headers.Authorization);
        Assert.Contains("\"id\":\"prod_abc123xyz\"", handler.LastRequestBody);
    }

    [Fact]
    public async Task GetCheckoutAsync_SendsAbsoluteUrlWithBearerAuth()
    {
        var handler = new CannedResponseHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(AbacatePayFixtures.ReadBytes("checkout-get-200.json")),
        });
        var client = new AbacatePayClient(new HttpClient(handler), "abc_test_key");

        var result = await client.GetCheckoutAsync("bill_abc123xyz", CancellationToken.None);

        Assert.True(result.TryGetValue(out var checkout));
        Assert.Equal(CheckoutStatus.Paid, checkout!.Status);
        Assert.True(handler.LastRequest!.RequestUri!.IsAbsoluteUri);
        Assert.Equal(
            "https://api.abacatepay.com/v2/checkouts/get?id=bill_abc123xyz",
            handler.LastRequest.RequestUri!.ToString());
        Assert.Equal(new AuthenticationHeaderValue("Bearer", "abc_test_key"), handler.LastRequest.Headers.Authorization);
    }

    [Fact]
    public async Task GetCheckoutAsync_HttpRequestException_ReturnsUnavailable()
    {
        var handler = new CannedResponseHandler(_ => throw new HttpRequestException("connection refused"));
        var client = new AbacatePayClient(new HttpClient(handler), "abc_test_key");

        var result = await client.GetCheckoutAsync("bill_abc123xyz", CancellationToken.None);

        var reason = result.Match(_ => (AbacatePayFailureReason?)null, failure => failure);
        Assert.Equal(AbacatePayFailureReason.Unavailable, reason);
    }

    [Fact]
    public async Task GetCheckoutAsync_TaskCanceledException_ReturnsUnavailable()
    {
        var handler = new CannedResponseHandler(_ => throw new TaskCanceledException("timed out"));
        var client = new AbacatePayClient(new HttpClient(handler), "abc_test_key");

        var result = await client.GetCheckoutAsync("bill_abc123xyz", CancellationToken.None);

        var reason = result.Match(_ => (AbacatePayFailureReason?)null, failure => failure);
        Assert.Equal(AbacatePayFailureReason.Unavailable, reason);
    }

    [Fact]
    public async Task GetCheckoutAsync_CooperativeCancellation_Propagates()
    {
        using var cts = new CancellationTokenSource();
        var handler = new CannedResponseHandler(_ =>
        {
            // O chamador cancela com o pedido em voo, como o SocketsHttpHandler real:
            // o send falha com TaskCanceledException mas o token do chamador está cancelado.
            cts.Cancel();
            throw new TaskCanceledException("caller cancelled in flight");
        });
        var client = new AbacatePayClient(new HttpClient(handler), "abc_test_key");

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            async () => await client.GetCheckoutAsync("bill_abc123xyz", cts.Token));
    }

    [Fact]
    public async Task GetCheckoutAsync_TruncatedBody_ReturnsMalformedResponse()
    {
        var handler = new CannedResponseHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"data\":{\"id\":\"bill_abc123xyz\",\"stat"),
        });
        var client = new AbacatePayClient(new HttpClient(handler), "abc_test_key");

        var result = await client.GetCheckoutAsync("bill_abc123xyz", CancellationToken.None);

        var reason = result.Match(_ => (AbacatePayFailureReason?)null, failure => failure);
        Assert.Equal(AbacatePayFailureReason.MalformedResponse, reason);
    }
}
