using Api.Billing;
using Microsoft.AspNetCore.Http;

namespace Api.Tests.Billing;

/// <summary>
/// BillingEndpoints.ReadBoundedBodyAsync sem servidor: o TestHost fixa sempre
/// ContentLength no comprimento real, por isso o caso ContentLength null (chunked)
/// só se prova abaixo dele, com DefaultHttpContext.
/// </summary>
public sealed class AbacatePayBodyLimitTests
{
    [Fact]
    public async Task ReadBoundedBodyAsync_NoContentLengthAndOverLimit_ReturnsNull()
    {
        var request = RequestWithBody(new byte[(64 * 1024) + 1]);

        Assert.Null(await BillingEndpoints.ReadBoundedBodyAsync(request, CancellationToken.None));
    }

    [Fact]
    public async Task ReadBoundedBodyAsync_NoContentLengthAndWithinLimit_ReturnsBytes()
    {
        var body = AbacatePayFixtures.ReadBytes("webhook-checkout-completed.json");
        var request = RequestWithBody(body);

        Assert.Equal(body, await BillingEndpoints.ReadBoundedBodyAsync(request, CancellationToken.None));
    }

    private static HttpRequest RequestWithBody(byte[] body)
    {
        var context = new DefaultHttpContext();
        context.Request.Body = new MemoryStream(body);
        return context.Request;
    }
}
