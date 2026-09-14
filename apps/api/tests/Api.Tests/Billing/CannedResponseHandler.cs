namespace Api.Tests.Billing;

/// <summary>
/// Substituto de ~15 linhas para <see cref="HttpMessageHandler"/> (molde do desenho do
/// seam do <c>HttpClient</c> na forma S12-01, secção 4): captura o pedido para se afirmar
/// <c>Authorization: Bearer</c> e a URL absoluta -- senão o stub passa e a produção devolve
/// 401. <paramref name="respond"/> pode lançar (ex. <see cref="HttpRequestException"/>,
/// <see cref="TaskCanceledException"/>) para simular falha de rede/timeout.
/// </summary>
internal sealed class CannedResponseHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    public HttpRequestMessage? LastRequest { get; private set; }
    public string? LastRequestBody { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastRequest = request;
        LastRequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        return respond(request);
    }
}
