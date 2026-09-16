using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using static Api.Problems.ProblemResults;

namespace Api.PatientLinks;

public static class SharingPreferencesEndpoints
{
    public static void MapSharingPreferencesEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/accounts/{accountId:guid}/sharing-preferences", HandleGetAsync)
            .WithName("GetSharingPreferences")
            .Produces<SharingPreferencesView>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");

        app.MapPut("/accounts/{accountId:guid}/sharing-preferences", HandlePutAsync)
            .WithName("PutSharingPreferences")
            .Produces<SharingPreferencesVersionView>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");
    }

    private static async Task<Results<Ok<SharingPreferencesView>, JsonHttpResult<LimmiarProblemDetails>>> HandleGetAsync(
        Guid accountId, SharingPreferencesStore store, CancellationToken cancellationToken)
    {
        var preferences = await store.GetPreferencesAsync(accountId, cancellationToken);
        return preferences is null
            ? ProblemJson(StatusCodes.Status404NotFound, "Sharing preferences not found", PatientLinksProblemCodes.SharingPreferencesNotFound)
            : TypedResults.Ok(new SharingPreferencesView(preferences.Version, preferences.WrappedDek, preferences.Ciphertext));
    }

    private static async Task<Results<Ok<SharingPreferencesVersionView>, JsonHttpResult<LimmiarProblemDetails>>> HandlePutAsync(
        Guid accountId, PutSharingPreferencesRequest request, SharingPreferencesStore store, CancellationToken cancellationToken)
    {
        if (request.ExpectedVersion < 0)
        {
            return ValidationProblem("expectedVersion");
        }
        if (!SharedItemEndpoints.TryValidateBlobSize(request.WrappedDek, "wrappedDek", out var wrappedDekProblem))
        {
            return wrappedDekProblem;
        }
        if (!SharedItemEndpoints.TryValidateBlobSize(request.Ciphertext, "ciphertext", out var ciphertextProblem))
        {
            return ciphertextProblem;
        }
        var updated = await store.PutPreferencesAsync(accountId, request.ExpectedVersion, request.WrappedDek, request.Ciphertext, cancellationToken);
        return updated is null
            ? ProblemJson(StatusCodes.Status409Conflict, "Sharing preferences version conflict", PatientLinksProblemCodes.SharingVersionConflict)
            : TypedResults.Ok(new SharingPreferencesVersionView(updated.Version));
    }
}
