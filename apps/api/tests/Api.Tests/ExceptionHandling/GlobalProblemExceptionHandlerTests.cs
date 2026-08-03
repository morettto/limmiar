using System.Text;
using System.Text.Json;
using Api.ExceptionHandling;
using Microsoft.AspNetCore.Http;

namespace Api.Tests.ExceptionHandling;

public sealed class GlobalProblemExceptionHandlerTests
{
    [Fact]
    public async Task TryHandleAsync_WritesConformingProblemDetails_AndReturnsTrue()
    {
        var handler = new GlobalProblemExceptionHandler();
        var httpContext = new DefaultHttpContext();
        using var responseBody = new MemoryStream();
        httpContext.Response.Body = responseBody;

        var secretMessage = "connection string password=hunter2 leaked at Foo.Bar.Baz line 42";
        var exception = new InvalidOperationException(secretMessage);

        var handled = await handler.TryHandleAsync(httpContext, exception, CancellationToken.None);

        Assert.True(handled);
        Assert.Equal(StatusCodes.Status500InternalServerError, httpContext.Response.StatusCode);
        Assert.Equal("application/problem+json", httpContext.Response.ContentType);

        responseBody.Seek(0, SeekOrigin.Begin);
        var bodyText = Encoding.UTF8.GetString(responseBody.ToArray());

        Assert.DoesNotContain(secretMessage, bodyText);
        Assert.DoesNotContain(nameof(InvalidOperationException), bodyText);

        using var doc = JsonDocument.Parse(bodyText);
        Assert.Equal(500, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("unexpected_error", doc.RootElement.GetProperty("code").GetString());
        Assert.Empty(doc.RootElement.GetProperty("params").EnumerateObject());
    }
}
