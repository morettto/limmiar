using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class MagicLinkIssuerTests
{
    private static readonly PatientAccessInvitation Invitation = new("0123456789AB", Guid.NewGuid(), Guid.NewGuid(), null);

    [Fact]
    public void IssueTicket_ReturnsNonEmptyOpaqueTicket()
    {
        var issuer = new MagicLinkIssuer();

        var ticket = issuer.IssueTicket(new MagicLinkTicketData(Invitation, MagicLinkCeremonyType.Register, [1, 2, 3], Guid.NewGuid()));

        Assert.NotEmpty(ticket);
    }

    [Fact]
    public void ConsumeTicket_WithFreshlyIssuedTicket_ReturnsTheData()
    {
        var issuer = new MagicLinkIssuer();
        var accountId = Guid.NewGuid();
        var data = new MagicLinkTicketData(
            Invitation, MagicLinkCeremonyType.Assert, [4, 5, 6], accountId, [7, 8], [9, 10], 3u);
        var ticket = issuer.IssueTicket(data);

        var result = issuer.ConsumeTicket(ticket);

        Assert.Equal(data, result);
    }

    [Fact]
    public void ConsumeTicket_WithUnknownTicket_ReturnsNull()
    {
        var issuer = new MagicLinkIssuer();

        var result = issuer.ConsumeTicket("never-issued");

        Assert.Null(result);
    }

    [Fact]
    public void ConsumeTicket_CalledTwice_SecondCallReturnsNull()
    {
        var issuer = new MagicLinkIssuer();
        var ticket = issuer.IssueTicket(new MagicLinkTicketData(Invitation, MagicLinkCeremonyType.Register, [1], Guid.NewGuid()));

        issuer.ConsumeTicket(ticket);
        var second = issuer.ConsumeTicket(ticket);

        Assert.Null(second);
    }

    [Fact]
    public void ConsumeTicket_AfterTicketLifetimeElapses_ReturnsNull()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new MagicLinkIssuer(clock: () => now);
        var ticket = issuer.IssueTicket(new MagicLinkTicketData(Invitation, MagicLinkCeremonyType.Register, [1], Guid.NewGuid()));

        now += MagicLinkIssuer.TicketLifetime + TimeSpan.FromSeconds(1);

        Assert.Null(issuer.ConsumeTicket(ticket));
    }

    [Fact]
    public void ConsumeTicket_JustBeforeTicketLifetimeElapses_Succeeds()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new MagicLinkIssuer(clock: () => now);
        var ticket = issuer.IssueTicket(new MagicLinkTicketData(Invitation, MagicLinkCeremonyType.Register, [1], Guid.NewGuid()));

        now += MagicLinkIssuer.TicketLifetime - TimeSpan.FromSeconds(1);

        Assert.NotNull(issuer.ConsumeTicket(ticket));
    }

}
