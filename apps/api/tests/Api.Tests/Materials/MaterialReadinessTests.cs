using System.Net;
using System.Text;
using Api.Materials;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Tests.Materials;

public sealed class MaterialReadinessTests
{
    [Theory]
    [InlineData("{\"materials\":[]}", MaterialReadinessResult.NotPrepared)]
    [InlineData("{}", MaterialReadinessResult.Unavailable)]
    [InlineData("not-json", MaterialReadinessResult.Unavailable)]
    [InlineData("{\"materials\":[{\"materialId\":12,\"ready\":true}]}", MaterialReadinessResult.Unavailable)]
    public async Task ResponseMustContainAuthoritativePreparedIds(string body, MaterialReadinessResult expected)
    {
        using var http = new HttpClient(new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") })) { BaseAddress = new Uri("http://copiloto.test/") };
        Assert.Equal(expected, await new MaterialReadiness(http).CheckAsync(Guid.NewGuid(), [Guid.NewGuid()], "Bearer owned-token", CancellationToken.None));
    }

    [Fact]
    public async Task MissingUrlAndNetworkFailureFailClosed()
    {
        using var http = new HttpClient(new Handler(_ => throw new HttpRequestException("offline")));
        var readiness = new MaterialReadiness(http);
        Assert.Equal(MaterialReadinessResult.Unavailable, await readiness.CheckAsync(Guid.NewGuid(), [Guid.NewGuid()], "Bearer token", CancellationToken.None));
        http.BaseAddress = new Uri("http://copiloto.test/");
        Assert.Equal(MaterialReadinessResult.Unavailable, await readiness.CheckAsync(Guid.NewGuid(), [Guid.NewGuid()], "Bearer token", CancellationToken.None));
    }

    [Theory]
    [InlineData("")]
    [InlineData("Basic credential")]
    public async Task InvalidAuthorizationNeverReachesBibliographicService(string authorization)
    {
        var sent = false;
        using var http = new HttpClient(new Handler(_ => { sent = true; return new HttpResponseMessage(HttpStatusCode.OK); })) { BaseAddress = new Uri("http://copiloto.test/") };
        Assert.Equal(MaterialReadinessResult.Unavailable, await new MaterialReadiness(http).CheckAsync(Guid.NewGuid(), [Guid.NewGuid()], authorization, CancellationToken.None));
        Assert.False(sent);
    }

    [Theory]
    [InlineData("{\"materials\":{}}", MaterialReadinessResult.Unavailable)]
    [InlineData("{\"materials\":[{\"ready\":true}]}", MaterialReadinessResult.Unavailable)]
    [InlineData("{\"materials\":[{\"materialId\":\"00000000-0000-0000-0000-000000000001\"}]}", MaterialReadinessResult.Unavailable)]
    [InlineData("{\"materials\":[{\"materialId\":\"00000000-0000-0000-0000-000000000001\",\"ready\":\"true\"}]}", MaterialReadinessResult.Unavailable)]
    [InlineData("{\"materials\":[{\"materialId\":\"00000000-0000-0000-0000-000000000001\",\"ready\":false}]}", MaterialReadinessResult.NotPrepared)]
    public async Task MalformedAndExplicitlyUnpreparedMaterialsAreNeverAuthorized(string body, MaterialReadinessResult expected)
    {
        using var http = new HttpClient(new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) })) { BaseAddress = new Uri("http://copiloto.test/") };
        Assert.Equal(expected, await new MaterialReadiness(http).CheckAsync(Guid.NewGuid(), [Guid.Parse("00000000-0000-0000-0000-000000000001")], "Bearer token", CancellationToken.None));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("relative/path")]
    [InlineData("ftp://copiloto.test/")]
    [InlineData("https://copiloto.test/internal")]
    public async Task ConfiguredClientOnlyUsesAbsoluteHttpUrls(string? url)
    {
        var sent = false;
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Copiloto:BaseUrl"] = url }).Build());
        services.AddMaterials();
        services.AddHttpClient<MaterialReadiness>().ConfigurePrimaryHttpMessageHandler(() => new Handler(request =>
        {
            sent = true;
            Assert.StartsWith("https://copiloto.test/internal/api/acervo/", request.RequestUri!.ToString());
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"materials\":[]}") };
        }));
        await using var provider = services.BuildServiceProvider();
        var result = await provider.GetRequiredService<MaterialReadiness>().CheckAsync(Guid.NewGuid(), [Guid.NewGuid()], "Bearer token", CancellationToken.None);
        Assert.Equal(url?.StartsWith("https://", StringComparison.Ordinal) == true ? MaterialReadinessResult.NotPrepared : MaterialReadinessResult.Unavailable, result);
        Assert.Equal(url?.StartsWith("https://", StringComparison.Ordinal) == true, sent);
    }

    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(response(request));
    }
}
