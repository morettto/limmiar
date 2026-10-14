using Api.Billing;

namespace Api.Tests.Billing;

/// <summary>Seams puros da fatia 5: política única global de no-show e decisão de reembolso.</summary>
public sealed class PublicBookingPolicyTests
{
    [Theory]
    [InlineData(0, NoShowVerdict.Excused)]
    [InlineData(1, NoShowVerdict.ForfeitsFee)]
    [InlineData(7, NoShowVerdict.ForfeitsFee)]
    public void Decide_MapsPriorCount(int faltasPrevias, NoShowVerdict expected)
    {
        Assert.Equal(expected, NoShowPolicy.Decide(faltasPrevias));
    }

    [Theory]
    [InlineData(true, PaymentStatus.Paid, true)]
    [InlineData(true, PaymentStatus.Pending, false)]
    [InlineData(true, PaymentStatus.Refunded, false)]
    [InlineData(true, PaymentStatus.Failed, false)]
    [InlineData(false, PaymentStatus.Paid, false)]
    [InlineData(false, PaymentStatus.Failed, false)]
    public void ShouldRefund_OnlyConflictWithPaid(bool conflito, PaymentStatus status, bool expected)
    {
        Assert.Equal(expected, RefundDecision.ShouldRefund(conflito, status));
    }
}
