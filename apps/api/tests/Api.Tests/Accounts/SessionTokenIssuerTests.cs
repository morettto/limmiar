using Api.Accounts;

namespace Api.Tests.Accounts;

/// <summary>
/// Covers <see cref="SessionTokenIssuer"/> directly -- issuance, rotation, reuse-detected
/// family revocation, and expiry (driven by an injected fake clock, same discipline as
/// <see cref="TwoFactorTicketIssuerTests"/>, never a real <c>Thread.Sleep</c>).
/// </summary>
public sealed class SessionTokenIssuerTests
{
    [Fact]
    public void IssuePair_ReturnsDistinctNonEmptyTokens()
    {
        var issuer = new SessionTokenIssuer();

        var pair = issuer.IssuePair(Guid.NewGuid());

        Assert.NotEqual(pair.AccessToken, pair.RefreshToken);
        Assert.NotEmpty(pair.AccessToken);
        Assert.NotEmpty(pair.RefreshToken);
    }

    [Fact]
    public void IssuePair_ReturnsDifferentPairsForDifferentCalls()
    {
        var issuer = new SessionTokenIssuer();

        var first = issuer.IssuePair(Guid.NewGuid());
        var second = issuer.IssuePair(Guid.NewGuid());

        Assert.NotEqual(first.RefreshToken, second.RefreshToken);
        Assert.NotEqual(first.AccessToken, second.AccessToken);
    }

    [Fact]
    public void Refresh_WithFreshlyIssuedToken_Succeeds()
    {
        var issuer = new SessionTokenIssuer();
        var issued = issuer.IssuePair(Guid.NewGuid());

        var result = issuer.Refresh(issued.RefreshToken);

        Assert.True(result.Succeeded);
        Assert.NotNull(result.TokenPair);
    }

    [Fact]
    public void Refresh_WithUnknownToken_Fails()
    {
        var issuer = new SessionTokenIssuer();

        var result = issuer.Refresh("never-issued");

        Assert.False(result.Succeeded);
        Assert.Equal(RefreshSessionFailureReason.InvalidToken, result.FailureReason);
    }

    /// <summary>
    /// Core rotation rule (Notion AC: "Refresh token usado uma vez nunca é aceito de
    /// novo"): once a refresh token has been exchanged, presenting THAT SAME token again
    /// must not succeed a second time.
    /// </summary>
    [Fact]
    public void Refresh_WithAlreadyUsedToken_FailsOnSecondPresentation()
    {
        var issuer = new SessionTokenIssuer();
        var issued = issuer.IssuePair(Guid.NewGuid());

        issuer.Refresh(issued.RefreshToken);
        var second = issuer.Refresh(issued.RefreshToken);

        Assert.False(second.Succeeded);
    }

    /// <summary>
    /// Core reuse-detection rule (Notion AC: "Reapresentação de token já usado revoga
    /// todos os tokens daquela família de sessão, não só o token em si"): the fresh token
    /// issued by the FIRST refresh -- which was never itself presented, let alone reused --
    /// must also die once the family it belongs to is caught being replayed.
    /// </summary>
    [Fact]
    public void Refresh_ReuseOfBurnedToken_RevokesTheEntireFamily()
    {
        var issuer = new SessionTokenIssuer();
        var issued = issuer.IssuePair(Guid.NewGuid());
        var afterFirstRefresh = issuer.Refresh(issued.RefreshToken).TokenPair!;

        // Replays the already-burned original token -- reuse detected.
        issuer.Refresh(issued.RefreshToken);

        var attemptWithLatestToken = issuer.Refresh(afterFirstRefresh.RefreshToken);

        Assert.False(attemptWithLatestToken.Succeeded);
    }

    /// <summary>
    /// Rebuilds a fresh chain per checked index rather than reusing one issuer for every
    /// check: presenting ANY already-used historical token is itself a reuse event that
    /// revokes the whole family (see <see cref="Refresh_ReuseOfBurnedToken_RevokesTheEntireFamily"/>),
    /// so checking token N would poison the family before token N+1 gets checked if they
    /// shared state. Isolating each check is what lets this test assert "every generation
    /// but the last fails" without that cascade masking the real per-token result.
    /// </summary>
    [Fact]
    public void Refresh_ChainOfRotations_OnlyTheLatestTokenIsEverValid()
    {
        const int rotations = 5;

        for (var checkedIndex = 0; checkedIndex <= rotations; checkedIndex++)
        {
            var issuer = new SessionTokenIssuer();
            var history = new List<string> { issuer.IssuePair(Guid.NewGuid()).RefreshToken };

            for (var i = 0; i < rotations; i++)
            {
                var result = issuer.Refresh(history[^1]);
                Assert.True(result.Succeeded);
                history.Add(result.TokenPair!.RefreshToken);
            }

            var isFrontierToken = checkedIndex == history.Count - 1;
            var succeeded = issuer.Refresh(history[checkedIndex]).Succeeded;
            Assert.Equal(isFrontierToken, succeeded);
        }
    }

    [Fact]
    public void Refresh_AfterRefreshTokenLifetimeElapses_Fails()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new SessionTokenIssuer(clock: () => now);
        var issued = issuer.IssuePair(Guid.NewGuid());

        now += SessionTokenIssuer.RefreshTokenLifetime + TimeSpan.FromSeconds(1);

        Assert.False(issuer.Refresh(issued.RefreshToken).Succeeded);
    }

    [Fact]
    public void Refresh_JustBeforeRefreshTokenLifetimeElapses_Succeeds()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new SessionTokenIssuer(clock: () => now);
        var issued = issuer.IssuePair(Guid.NewGuid());

        now += SessionTokenIssuer.RefreshTokenLifetime - TimeSpan.FromSeconds(1);

        Assert.True(issuer.Refresh(issued.RefreshToken).Succeeded);
    }

    [Fact]
    public void Refresh_OfOneFamily_DoesNotAffectAnotherAccountsFamily()
    {
        var issuer = new SessionTokenIssuer();
        var victim = issuer.IssuePair(Guid.NewGuid());
        var bystander = issuer.IssuePair(Guid.NewGuid());

        issuer.Refresh(victim.RefreshToken);
        // Replay -- revokes only the victim's family.
        issuer.Refresh(victim.RefreshToken);

        Assert.True(issuer.Refresh(bystander.RefreshToken).Succeeded);
    }

    [Fact]
    public void ValidateAccess_WithFreshlyIssuedToken_ReturnsTheAccountId()
    {
        var accountId = Guid.NewGuid();
        var issuer = new SessionTokenIssuer();
        var issued = issuer.IssuePair(accountId);

        Assert.Equal(accountId, issuer.ValidateAccess(issued.AccessToken));
    }

    [Fact]
    public void ValidateAccess_WithUnknownToken_ReturnsNull()
    {
        var issuer = new SessionTokenIssuer();

        Assert.Null(issuer.ValidateAccess("never-issued"));
    }

    /// <summary>
    /// Security-review finding: an access token minted just before its family gets
    /// revoked by reuse detection must not keep validating for the rest of its own
    /// lifetime -- family revocation has to reach every token type, not just refresh
    /// tokens, or a stolen access token survives the very incident response this ticket
    /// exists to provide.
    /// </summary>
    [Fact]
    public void ValidateAccess_AfterFamilyIsRevokedByReuseDetection_ReturnsNull()
    {
        var issuer = new SessionTokenIssuer();
        var issued = issuer.IssuePair(Guid.NewGuid());
        var afterRefresh = issuer.Refresh(issued.RefreshToken).TokenPair!;

        // Replays the already-burned original refresh token -- reuse detected, family revoked.
        issuer.Refresh(issued.RefreshToken);

        Assert.Null(issuer.ValidateAccess(afterRefresh.AccessToken));
    }

    [Fact]
    public void ValidateAccess_AfterAccessTokenLifetimeElapses_ReturnsNull()
    {
        var now = DateTimeOffset.UtcNow;
        var issuer = new SessionTokenIssuer(clock: () => now);
        var issued = issuer.IssuePair(Guid.NewGuid());

        now += SessionTokenIssuer.AccessTokenLifetime + TimeSpan.FromSeconds(1);

        Assert.Null(issuer.ValidateAccess(issued.AccessToken));
    }

    /// <summary>
    /// Property-based coverage of the Notion AC "Baseado em propriedade: para qualquer
    /// sequência de operações, nenhum token de geração anterior é aceito." Fixed seed for
    /// reproducibility (a failure here must reproduce identically on the next run, not
    /// flake). Drives a randomized sequence of {rotate forward, replay an already-seen
    /// past token} against a single family and checks the invariant after every step:
    /// exactly the most recently issued, not-yet-presented token is valid, and the moment
    /// any past token is replayed, the family is dead for good (even the current frontier
    /// token stops working).
    /// </summary>
    [Fact]
    public void Refresh_PropertyBased_OnlyTheCurrentFrontierTokenIsEverAcceptedForAnyOperationSequence()
    {
        var random = new Random(Seed: 20260808);
        var issuer = new SessionTokenIssuer();
        var seenTokens = new List<string> { issuer.IssuePair(Guid.NewGuid()).RefreshToken };
        var currentToken = seenTokens[0];
        var familyRevoked = false;

        for (var step = 0; step < 200; step++)
        {
            var replay = seenTokens.Count > 1 && random.Next(2) == 0;

            if (replay)
            {
                // Pick any past token that is NOT the current frontier token.
                var pastToken = seenTokens[random.Next(seenTokens.Count - 1)];
                var result = issuer.Refresh(pastToken);

                Assert.False(result.Succeeded);
                familyRevoked = true;
            }
            else if (!familyRevoked)
            {
                var result = issuer.Refresh(currentToken);

                Assert.True(result.Succeeded);
                currentToken = result.TokenPair!.RefreshToken;
                seenTokens.Add(currentToken);
            }
            else
            {
                // Family already dead -- even the last-known frontier token must fail too.
                Assert.False(issuer.Refresh(currentToken).Succeeded);
            }
        }
    }
}
