using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using static Api.Problems.ProblemResults;

namespace Api.PatientLinks;

/// <summary>
/// Server-opaque envelope sharing (S11-02 fatia 1). Handlers talk straight to
/// <see cref="SharedItemStore"/>, no service layer -- authorization
/// IS the link (verified inside the store, under the same lock as the write, see abordagem (c)).
/// </summary>
public static class SharedItemEndpoints
{
    // AES-256-GCM wire format floor (SealedBlobShape) up to this ceiling -- big enough for a
    // day's worth of check-in JSON, small enough that one account cannot balloon the in-memory
    // store. ponytail: fixed ceiling, no per-account quota; revisit if a real item type outgrows it.
    internal const int MaxBlobBytes = 64 * 1024;

    public static void MapSharedItemEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/accounts/{accountId:guid}/links/{peerAccountId:guid}/shared-items", HandleShareAsync)
            .WithName("ShareItem")
            .WithSummary("Append an opaque encrypted envelope to what accountId (the patient side) shares with peerAccountId (the professional side)")
            .WithDescription("The server never sees the item type or plaintext, only ciphertext. 404 if there is no link with accountId as the patient and peerAccountId as the professional -- direction matters. Requires an Authorization: Bearer access token for this exact account.")
            .Produces(StatusCodes.Status204NoContent)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");

        app.MapGet("/accounts/{accountId:guid}/links/{peerAccountId:guid}/shared-items", HandleListSharedAsync)
            .WithName("ListSharedItems")
            .WithSummary("List what peerAccountId (the patient side) shared with accountId (the professional side)")
            .WithDescription("404 if there is no link with accountId as the professional and peerAccountId as the patient -- direction matters. Unlinking hides items (404) without deleting them; re-linking surfaces them again. Requires an Authorization: Bearer access token for this exact account.")
            .Produces<IReadOnlyList<SharedItemView>>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");

        app.MapGet("/accounts/{accountId:guid}/received-shares", HandleListReceivedSharesAsync)
            .WithName("ListReceivedShares")
            .WithSummary("List every patient accountId (the professional side) was ever linked to, with everything shared along the way")
            .WithDescription("Unlike GET shared-items, this never 404s and never hides a soft-unlinked pair -- unlinkedAt is null while the pair is still linked, a timestamp once undone. Always 200, [] if accountId was never linked to anyone. Requires an Authorization: Bearer access token for this exact account.")
            .Produces<IReadOnlyList<ReceivedShareView>>(StatusCodes.Status200OK);

    }

    private static async Task<Results<NoContent, JsonHttpResult<LimmiarProblemDetails>>> HandleShareAsync(
        Guid accountId,
        Guid peerAccountId,
        ShareItemRequest request,
        SharedItemStore store,
        CancellationToken cancellationToken)
    {
        if (!TryValidateBlobSize(request.Ciphertext, "ciphertext", out var problem))
        {
            return problem;
        }

        if (!await store.ShareAsync(accountId, peerAccountId, request.Ciphertext, cancellationToken))
        {
            return ProblemJson(StatusCodes.Status404NotFound, "Link not found", PatientLinksProblemCodes.LinkNotFound);
        }

        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<IReadOnlyList<SharedItemView>>, JsonHttpResult<LimmiarProblemDetails>>> HandleListSharedAsync(
        Guid accountId,
        Guid peerAccountId,
        SharedItemStore store,
        CancellationToken cancellationToken)
    {
        var items = await store.ListSharedAsync(accountId, peerAccountId, cancellationToken);
        if (items is null)
        {
            return ProblemJson(StatusCodes.Status404NotFound, "Link not found", PatientLinksProblemCodes.LinkNotFound);
        }

        return TypedResults.Ok<IReadOnlyList<SharedItemView>>(
            items.Select(item => new SharedItemView(item.SharedAt, item.Ciphertext)).ToArray());
    }

    private static async Task<Ok<IReadOnlyList<ReceivedShareView>>> HandleListReceivedSharesAsync(
        Guid accountId,
        SharedItemStore store,
        CancellationToken cancellationToken)
    {
        var shares = await store.ListReceivedSharesAsync(accountId, cancellationToken);
        return TypedResults.Ok<IReadOnlyList<ReceivedShareView>>(shares.Select(ToView).ToArray());
    }

    private static ReceivedShareView ToView(ReceivedShare share) =>
        new(
            share.PatientAccountId,
            share.PatientId,
            share.LinkedAt,
            share.UnlinkedAt,
            share.PeerPublicKey,
            share.Items.Select(item => new SharedItemView(item.SharedAt, item.Ciphertext)).ToArray());

    internal static bool TryValidateBlobSize(byte[]? blob, string field, out JsonHttpResult<LimmiarProblemDetails> problem)
    {
        if (!SealedBlobShape.TryValidateSealedBlobShape(blob, field, out problem))
        {
            return false;
        }

        if (blob!.Length > MaxBlobBytes)
        {
            problem = ValidationProblem(field);
            return false;
        }

        return true;
    }
}

public sealed record ShareItemRequest(byte[] Ciphertext);

public sealed record SharedItemView(DateTimeOffset SharedAt, byte[] Ciphertext);

public sealed record ReceivedShareView(
    Guid PatientAccountId, Guid PatientId, DateTimeOffset LinkedAt, DateTimeOffset? UnlinkedAt,
    byte[]? PeerPublicKey, IReadOnlyList<SharedItemView> Items);

public sealed record PutSharingPreferencesRequest(long ExpectedVersion, byte[] WrappedDek, byte[] Ciphertext);

public sealed record SharingPreferencesView(long Version, byte[] WrappedDek, byte[] Ciphertext);

public sealed record SharingPreferencesVersionView(long Version);
