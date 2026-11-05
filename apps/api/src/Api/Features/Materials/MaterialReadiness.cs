using System.Net.Http.Headers;
using System.Text.Json;

namespace Api.Materials;

public enum MaterialReadinessResult { Ready, NotPrepared, Unavailable }

public sealed class MaterialReadiness(HttpClient http)
{
    public async Task<MaterialReadinessResult> CheckAsync(Guid owner, Guid[] ids, string authorization, CancellationToken ct)
    {
        if (http.BaseAddress is null) return MaterialReadinessResult.Unavailable;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"api/acervo/{owner}");
            if (!AuthenticationHeaderValue.TryParse(authorization, out var bearer) || bearer.Scheme != "Bearer")
                return MaterialReadinessResult.Unavailable;
            request.Headers.Authorization = bearer;
            using var response = await http.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode) return MaterialReadinessResult.Unavailable;
            using var body = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            if (!body.RootElement.TryGetProperty("materials", out var materials) || materials.ValueKind != JsonValueKind.Array)
                return MaterialReadinessResult.Unavailable;
            var ready = new HashSet<Guid>();
            foreach (var item in materials.EnumerateArray())
            {
                if (!item.TryGetProperty("materialId", out var materialId) || !materialId.TryGetGuid(out var id)
                    || !item.TryGetProperty("ready", out var prepared) || prepared.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    return MaterialReadinessResult.Unavailable;
                if (prepared.GetBoolean()) ready.Add(id);
            }
            return ids.All(ready.Contains) ? MaterialReadinessResult.Ready : MaterialReadinessResult.NotPrepared;
        }
        catch (Exception error) when (error is HttpRequestException or JsonException or InvalidOperationException || error is OperationCanceledException && !ct.IsCancellationRequested)
        {
            return MaterialReadinessResult.Unavailable;
        }
    }
}
