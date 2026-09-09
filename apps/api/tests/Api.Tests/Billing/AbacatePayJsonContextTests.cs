using System.Text.Json;
using Api.Billing;

namespace Api.Tests.Billing;

/// <summary>
/// Critério de aceite 1: o contrato fixado contra a documentação publicada, provado por
/// fixture, sobre o próprio <see cref="AbacatePayJsonContext"/> gerado por source-gen (sem
/// <c>JsonSerializerOptions</c> em runtime -- AOT-safe).
/// </summary>
public sealed class AbacatePayJsonContextTests
{
    [Fact]
    public void CheckoutCreate200_Deserializes_PendingStatus()
    {
        var bytes = AbacatePayFixtures.ReadBytes("checkout-create-200.json");

        var envelope = JsonSerializer.Deserialize(bytes, AbacatePayJsonContext.Default.CheckoutEnvelope);

        Assert.NotNull(envelope);
        Assert.True(envelope.Success);
        Assert.NotNull(envelope.Data);
        Assert.Equal("bill_abc123xyz", envelope.Data.Id);
        Assert.Equal(CheckoutStatus.Pending, envelope.Data.Status);
    }

    [Fact]
    public void CheckoutGet200_Deserializes_PaidStatus()
    {
        var bytes = AbacatePayFixtures.ReadBytes("checkout-get-200.json");

        var envelope = JsonSerializer.Deserialize(bytes, AbacatePayJsonContext.Default.CheckoutEnvelope);

        Assert.NotNull(envelope);
        Assert.True(envelope.Success);
        Assert.NotNull(envelope.Data);
        Assert.Equal(CheckoutStatus.Paid, envelope.Data.Status);
    }

    [Fact]
    public void Error401_DeserializesWithSuccessFalseAndNoData()
    {
        var bytes = AbacatePayFixtures.ReadBytes("error-401.json");

        var envelope = JsonSerializer.Deserialize(bytes, AbacatePayJsonContext.Default.CheckoutEnvelope);

        Assert.NotNull(envelope);
        Assert.False(envelope.Success);
        Assert.Null(envelope.Data);
    }
}
