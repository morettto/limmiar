using Api.Billing;

namespace Api.Tests.Billing;

/// <summary>Seams puros do dinheiro: mapear o status de fio para <see cref="PaymentStatus"/> e o
/// adaptador de reembolso sem endpoint documentado no fornecedor.</summary>
public sealed class AbacatePayMapperTests
{
    [Theory]
    [InlineData(CheckoutStatus.Pending, PaymentStatus.Pending)]
    [InlineData(CheckoutStatus.Paid, PaymentStatus.Paid)]
    [InlineData(CheckoutStatus.Refunded, PaymentStatus.Refunded)]
    [InlineData(CheckoutStatus.Expired, PaymentStatus.Failed)]
    [InlineData(CheckoutStatus.Cancelled, PaymentStatus.Failed)]
    public void ToPaymentStatus_MapsWireStatus(CheckoutStatus wire, PaymentStatus expected)
    {
        Assert.Equal(expected, AbacatePayMapper.ToPaymentStatus(wire));
    }

    [Fact]
    public async Task RefundAsync_WithoutDocumentedEndpoint_ReturnsProviderHasNoRefund()
    {
        using var http = new HttpClient();
        var client = new AbacatePayClient(http, "test-key");

        var outcome = await client.RefundAsync("rsv_anything", CancellationToken.None);

        Assert.Equal(RefundOutcome.ProviderHasNoRefund, outcome);
    }
}
