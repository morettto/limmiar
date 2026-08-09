using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Covers <see cref="MagicLinkIssuer"/> directly -- token issuance/consumption and ticket
/// issuance/consumption are independent single-use surfaces, each with its own expiry, driven
/// by an injected fake clock (same discipline as <see cref="DevicePairingIssuerTests"/>/
/// <see cref="TwoFactorTicketIssuerTests"/>, never a real <c>Thread.Sleep</c>).
/// </summary>
public sealed class MagicLinkIssuerTests
{
    private const string Email = "patient@example.com";

    [Fact]
    public void IssueToken_ReturnsNonEmptyOpaqueToken()
    {
        var issuer = new MagicLinkIssuer();

        var token = issuer.IssueToken(Email);

        Assert.NotEmpty(token);
    }

    [Fact]
    public void IssueToken_ReturnsDifferentTokensForDifferentCalls()
    {
        var issuer = new MagicLinkIssuer();

        var first = issuer.IssueToken(Email);
        var second = issuer.IssueToken(Email);

        Assert.NotEqual(first, second);
    }

    [Fact]
    public void ConsumeToken_WithFreshlyIssuedToken_ReturnsBoundEmail()
    {
        var issuer = new MagicLinkIssuer();
        var token = issuer.IssueToken(Email);

        var result = issuer.ConsumeToken(token);

        Assert.Equal(Email, result);
    }

    [Fact]
    public void ConsumeToken_WithUnknownToken_ReturnsNull()
    {
        var issuer = new MagicLinkIssuer();

        var result = issuer.ConsumeToken("never-issued");

        Assert.Null(result);
    }

    /// <summary>Core replay rule: a magic-link token is worth exactly one consumption.</summary>
    [Fact]
    public void ConsumeToken_CalledTwice_SecondCallReturnsNull()
    {
        var issuer = new MagicLinkIssuer();
        var token = issuer.IssueToken(Email);

        issuer.ConsumeToken(token);
        var second = issuer.ConsumeToken(token);

        Assert.Null(second);
    }

    [Fact]
    public void ConsumeToken_AfterTokenLifetimeElapses_ReturnsNull()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new MagicLinkIssuer(clock: () => now);
        var token = issuer.IssueToken(Email);

        now += MagicLinkIssuer.DefaultTokenLifetime + TimeSpan.FromSeconds(1);

        var result = issuer.ConsumeToken(token);

        Assert.Null(result);
    }

    [Fact]
    public void ConsumeToken_JustBeforeTokenLifetimeElapses_Succeeds()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new MagicLinkIssuer(clock: () => now);
        var token = issuer.IssueToken(Email);

        now += MagicLinkIssuer.DefaultTokenLifetime - TimeSpan.FromSeconds(1);

        Assert.Equal(Email, issuer.ConsumeToken(token));
    }

    [Fact]
    public void ConsumeToken_WithCustomTokenLifetime_HonorsIt()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new MagicLinkIssuer(clock: () => now, tokenLifetime: TimeSpan.FromSeconds(30));
        var token = issuer.IssueToken(Email);

        now += TimeSpan.FromSeconds(31);

        Assert.Null(issuer.ConsumeToken(token));
    }

    [Fact]
    public void IssueTicket_ReturnsNonEmptyOpaqueTicket()
    {
        var issuer = new MagicLinkIssuer();

        var ticket = issuer.IssueTicket(new MagicLinkTicketData(Email, MagicLinkCeremonyType.Register, [1, 2, 3]));

        Assert.NotEmpty(ticket);
    }

    [Fact]
    public void ConsumeTicket_WithFreshlyIssuedTicket_ReturnsTheData()
    {
        var issuer = new MagicLinkIssuer();
        var accountId = Guid.NewGuid();
        var data = new MagicLinkTicketData(
            Email, MagicLinkCeremonyType.Assert, [4, 5, 6], accountId, [7, 8], [9, 10], 3u);
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

    /// <summary>Core replay rule for the second single-use surface, independent of the token's.</summary>
    [Fact]
    public void ConsumeTicket_CalledTwice_SecondCallReturnsNull()
    {
        var issuer = new MagicLinkIssuer();
        var ticket = issuer.IssueTicket(new MagicLinkTicketData(Email, MagicLinkCeremonyType.Register, [1]));

        issuer.ConsumeTicket(ticket);
        var second = issuer.ConsumeTicket(ticket);

        Assert.Null(second);
    }

    [Fact]
    public void ConsumeTicket_AfterTicketLifetimeElapses_ReturnsNull()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new MagicLinkIssuer(clock: () => now);
        var ticket = issuer.IssueTicket(new MagicLinkTicketData(Email, MagicLinkCeremonyType.Register, [1]));

        now += MagicLinkIssuer.TicketLifetime + TimeSpan.FromSeconds(1);

        Assert.Null(issuer.ConsumeTicket(ticket));
    }

    [Fact]
    public void ConsumeTicket_JustBeforeTicketLifetimeElapses_Succeeds()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new MagicLinkIssuer(clock: () => now);
        var ticket = issuer.IssueTicket(new MagicLinkTicketData(Email, MagicLinkCeremonyType.Register, [1]));

        now += MagicLinkIssuer.TicketLifetime - TimeSpan.FromSeconds(1);

        Assert.NotNull(issuer.ConsumeTicket(ticket));
    }

    /// <summary>Token and ticket single-use tracking must be independent stores -- consuming one must not affect the other.</summary>
    [Fact]
    public void ConsumeToken_AndConsumeTicket_AreIndependentSingleUseStores()
    {
        var issuer = new MagicLinkIssuer();
        var token = issuer.IssueToken(Email);
        var ticket = issuer.IssueTicket(new MagicLinkTicketData(Email, MagicLinkCeremonyType.Register, [1]));

        issuer.ConsumeToken(token);

        Assert.NotNull(issuer.ConsumeTicket(ticket));
    }
}
