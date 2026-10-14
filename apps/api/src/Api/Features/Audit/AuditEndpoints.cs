using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Api.Audit;

public static class AuditComposition
{
    public static void AddAudit(this IServiceCollection services)
    {
        services.AddSingleton(sp => new AuditEntryStore(sp.GetRequiredService<Npgsql.NpgsqlDataSource>()));
        services.AddSingleton<AuditRecorder>();
        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.TypeInfoResolverChain.Insert(0, AuditJsonContext.Default);
            options.SerializerOptions.Converters.Add(new JsonStringEnumConverter<AuditAction>(JsonNamingPolicy.CamelCase));
            options.SerializerOptions.Converters.Add(new JsonStringEnumConverter<AuditBreakKind>(JsonNamingPolicy.CamelCase));
        });
    }

    public static void MapAudit(this IEndpointRouteBuilder app)
    {
        app.MapGet("/accounts/{accountId:guid}/audit", HandleListAsync)
            .WithName("GetAuditTrail")
            .WithSummary("Read this account's audit trail and verify its hash chain")
            .WithDescription("Metadata only: action, session (device) and instant -- never clinical content. The whole chain and its anchors are verified before the optional [from, to) filter is applied.")
            .Produces<AuditTrailResponse>(StatusCodes.Status200OK);

        app.MapPost("/accounts/{accountId:guid}/audit/exports", HandleExportAsync)
            .WithName("PostAuditExport")
            .WithSummary("Export the audit trail, recording the export itself")
            .WithDescription("Appends ExportRequested to the chain first, so the export it returns already contains its own record.")
            .Produces<AuditTrailResponse>(StatusCodes.Status200OK);
    }

    private static async Task<Ok<AuditTrailResponse>> HandleListAsync(
        Guid accountId, DateTimeOffset? from, DateTimeOffset? to, AuditEntryStore store, CancellationToken ct) =>
        TypedResults.Ok(await ReadAsync(accountId, from, to, store, ct));

    private static async Task<Ok<AuditTrailResponse>> HandleExportAsync(
        Guid accountId, DateTimeOffset? from, DateTimeOffset? to, HttpContext context, AuditRecorder recorder, AuditEntryStore store, CancellationToken ct)
    {
        await recorder.RecordAsync(context, AuditAction.ExportRequested, ct);
        return TypedResults.Ok(await ReadAsync(accountId, from, to, store, ct));
    }

    private static async Task<AuditTrailResponse> ReadAsync(Guid accountId, DateTimeOffset? from, DateTimeOffset? to, AuditEntryStore store, CancellationToken ct)
    {
        var chain = await store.ListAsync(accountId, ct);
        var verification = AuditChain.Verify(chain, await store.ListAnchorsAsync(accountId, ct));
        var entries = chain
            .Where(entry => (from is not { } start || entry.RecordedAt >= start) && (to is not { } end || entry.RecordedAt < end))
            .Select(entry => new AuditEntryResponse(entry.Sequence, entry.Action, entry.DeviceId, entry.RecordedAt))
            .ToList();
        return new AuditTrailResponse(verification.Intact, verification.FirstBrokenSequence, verification.BreakKind, entries);
    }
}

public sealed record AuditEntryResponse(long Sequence, AuditAction Action, Guid DeviceId, DateTimeOffset RecordedAt);

public sealed record AuditTrailResponse(bool Intact, long? FirstBrokenSequence, AuditBreakKind? BreakKind, IReadOnlyList<AuditEntryResponse> Entries);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, UseStringEnumConverter = true)]
[JsonSerializable(typeof(AuditTrailResponse))]
public partial class AuditJsonContext : JsonSerializerContext
{
}
