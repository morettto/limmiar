using Api.Accounts;

namespace Api.Tests.Accounts;

public sealed class TwoFactorTicketIssuerTests
{
    [Fact]
    public void Issue_ThenValidate_WithSameAccountId_ReturnsTrue()
    {
        var accountId = Guid.NewGuid();
        var issuer = new TwoFactorTicketIssuer();

        var ticket = issuer.Issue(accountId);

        Assert.True(issuer.Validate(ticket, accountId));
    }

    [Fact]
    public void Validate_WithUnknownTicket_ReturnsFalse()
    {
        var issuer = new TwoFactorTicketIssuer();

        Assert.False(issuer.Validate("never-issued", Guid.NewGuid()));
    }

    [Fact]
    public void Validate_WithTicketIssuedForAnotherAccount_ReturnsFalse()
    {
        var issuer = new TwoFactorTicketIssuer();
        var ticket = issuer.Issue(Guid.NewGuid());

        Assert.False(issuer.Validate(ticket, Guid.NewGuid()));
    }

    [Fact]
    public void Invalidate_ThenValidate_ReturnsFalse()
    {
        var accountId = Guid.NewGuid();
        var issuer = new TwoFactorTicketIssuer();
        var ticket = issuer.Issue(accountId);

        issuer.Invalidate(ticket);

        Assert.False(issuer.Validate(ticket, accountId));
    }

    [Fact]
    public void Invalidate_WithUnknownTicket_DoesNotThrow()
    {
        var issuer = new TwoFactorTicketIssuer();

        var exception = Record.Exception(() => issuer.Invalidate("never-issued"));

        Assert.Null(exception);
    }

    [Fact]
    public void Validate_AfterTicketLifetimeElapses_ReturnsFalse()
    {
        var accountId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        var issuer = new TwoFactorTicketIssuer(clock: () => now);
        var ticket = issuer.Issue(accountId);

        now += TwoFactorTicketIssuer.TicketLifetime + TimeSpan.FromSeconds(1);

        Assert.False(issuer.Validate(ticket, accountId));
    }

    [Fact]
    public void Validate_JustBeforeTicketLifetimeElapses_ReturnsTrue()
    {
        var accountId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        var issuer = new TwoFactorTicketIssuer(clock: () => now);
        var ticket = issuer.Issue(accountId);

        now += TwoFactorTicketIssuer.TicketLifetime - TimeSpan.FromSeconds(1);

        Assert.True(issuer.Validate(ticket, accountId));
    }

    [Fact]
    public void Issue_ReturnsDifferentTicketsForDifferentCalls()
    {
        var issuer = new TwoFactorTicketIssuer();

        var first = issuer.Issue(Guid.NewGuid());
        var second = issuer.Issue(Guid.NewGuid());

        Assert.NotEqual(first, second);
    }
}
