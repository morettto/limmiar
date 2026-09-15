using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using static Api.Problems.ProblemResults;

namespace Api.PatientLinks;

/// <summary>
/// Server-opaque envelope sharing (S11-02 fatia 1) and the sharing-preferences blob (fatia 2).
/// Handlers talk straight to <see cref="PatientLinkStore"/>, no service layer -- authorization
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

        app.MapGet("/accounts/{accountId:guid}/sharing-preferences", HandleGetPreferencesAsync)
            .WithName("GetSharingPreferences")
            .WithSummary("Fetch this account's sharing-preferences blob")
            .WithDescription("Opaque to the server: a DEK wrapped by the account's own KEK plus the ciphertext it protects. 404 if the account never saved preferences. Requires an Authorization: Bearer access token for this exact account.")
            .Produces<SharingPreferencesView>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");

        app.MapPut("/accounts/{accountId:guid}/sharing-preferences", HandlePutPreferencesAsync)
            .WithName("PutSharingPreferences")
            .WithSummary("Replace this account's sharing-preferences blob under optimistic concurrency")
            .WithDescription("expectedVersion must match the account's current version (0 = never saved); the store then advances it by exactly 1. 409 sharing.version_conflict on a stale expectedVersion -- the caller re-reads and retries. Requires an Authorization: Bearer access token for this exact account.")
            .Produces<SharingPreferencesVersionView>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");
    }

    private static Results<NoContent, JsonHttpResult<LimmiarProblemDetails>> HandleShareAsync(
        Guid accountId,
        Guid peerAccountId,
        ShareItemRequest request,
        PatientLinkStore store)
    {
        if (!TryValidateBlobSize(request.Ciphertext, "ciphertext", out var problem))
        {
            return problem;
        }

        if (!store.Share(accountId, peerAccountId, request.Ciphertext))
        {
            return ProblemJson(StatusCodes.Status404NotFound, "Link not found", PatientLinksProblemCodes.LinkNotFound);
        }

        return TypedResults.NoContent();
    }

    private static Results<Ok<IReadOnlyList<SharedItemView>>, JsonHttpResult<LimmiarProblemDetails>> HandleListSharedAsync(
        Guid accountId,
        Guid peerAccountId,
        PatientLinkStore store)
    {
        var items = store.ListShared(accountId, peerAccountId);
        if (items is null)
        {
            return ProblemJson(StatusCodes.Status404NotFound, "Link not found", PatientLinksProblemCodes.LinkNotFound);
        }

        return TypedResults.Ok<IReadOnlyList<SharedItemView>>(
            items.Select(item => new SharedItemView(item.SharedAt, item.Ciphertext)).ToArray());
    }

    private static Results<Ok<SharingPreferencesView>, JsonHttpResult<LimmiarProblemDetails>> HandleGetPreferencesAsync(
        Guid accountId,
        PatientLinkStore store)
    {
        var preferences = store.GetPreferences(accountId);
        if (preferences is null)
        {
            return ProblemJson(StatusCodes.Status404NotFound, "Sharing preferences not found", PatientLinksProblemCodes.SharingPreferencesNotFound);
        }

        return TypedResults.Ok(ToView(preferences));
    }

    private static Results<Ok<SharingPreferencesVersionView>, JsonHttpResult<LimmiarProblemDetails>> HandlePutPreferencesAsync(
        Guid accountId,
        PutSharingPreferencesRequest request,
        PatientLinkStore store)
    {
        if (request.ExpectedVersion < 0)
        {
            return ValidationProblem("expectedVersion");
        }

        if (!TryValidateBlobSize(request.WrappedDek, "wrappedDek", out var wrappedDekProblem))
        {
            return wrappedDekProblem;
        }

        if (!TryValidateBlobSize(request.Ciphertext, "ciphertext", out var ciphertextProblem))
        {
            return ciphertextProblem;
        }

        var result = store.PutPreferences(accountId, request.ExpectedVersion, request.WrappedDek, request.Ciphertext);
        return result.Match<Results<Ok<SharingPreferencesVersionView>, JsonHttpResult<LimmiarProblemDetails>>>(
            updated => TypedResults.Ok(new SharingPreferencesVersionView(updated.Version)),
            _ => ProblemJson(StatusCodes.Status409Conflict, "Sharing preferences version conflict", PatientLinksProblemCodes.SharingVersionConflict));
    }

    private static SharingPreferencesView ToView(SharingPreferences preferences) =>
        new(preferences.Version, preferences.WrappedDek, preferences.Ciphertext);

    private static bool TryValidateBlobSize(byte[]? blob, string field, out JsonHttpResult<LimmiarProblemDetails> problem)
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

public sealed record PutSharingPreferencesRequest(long ExpectedVersion, byte[] WrappedDek, byte[] Ciphertext);

public sealed record SharingPreferencesView(long Version, byte[] WrappedDek, byte[] Ciphertext);

public sealed record SharingPreferencesVersionView(long Version);
