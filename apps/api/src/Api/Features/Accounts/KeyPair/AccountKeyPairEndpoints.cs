using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using static Api.Problems.ProblemResults;
using static Api.Problems.SealedBlobShape;

namespace Api.Accounts;

public static class AccountKeyPairEndpoints
{
    private const int PublicKeyLength = 32;

    public static void MapAccountKeyPairEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPut("/accounts/{accountId:guid}/key-pair", HandlePutAsync)
            .WithName("PutAccountKeyPair")
            .WithSummary("Publish (or replace) the account's X25519 key pair envelope")
            .WithDescription("The public key is immutable once published: republishing the SAME public key replaces wrappedDek/sealedPrivateKey (204, serves KEK rotation); a DIFFERENT public key is 409 (the first publication wins). Requires an Authorization: Bearer access token for this exact account. 401 without/invalid token, 403 for a valid token of another account (RFC 9110, RequireAccountAccessMiddleware).")
            .Produces(StatusCodes.Status204NoContent)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapGet("/accounts/{accountId:guid}/key-pair", HandleGetAsync)
            .WithName("GetAccountKeyPair")
            .WithSummary("Read the account's own X25519 key pair envelope")
            .WithDescription("404 if the account never published a key pair. Requires an Authorization: Bearer access token for this exact account. 401 without/invalid token, 403 for a valid token of another account (RequireAccountAccessMiddleware).")
            .Produces<AccountKeyPairResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");
    }

    private static async Task<Results<NoContent, JsonHttpResult<LimmiarProblemDetails>>> HandlePutAsync(
        Guid accountId,
        AccountKeyPairRequest request,
        AccountKeyPairService keyPairService,
        CancellationToken cancellationToken)
    {
        if (request.PublicKey.Length != PublicKeyLength)
        {
            return ValidationProblem("publicKey");
        }

        if (!TryValidateSealedBlobShape(request.WrappedDek, "wrappedDek", out var wrappedDekProblem))
        {
            return wrappedDekProblem;
        }

        if (!TryValidateSealedBlobShape(request.SealedPrivateKey, "sealedPrivateKey", out var sealedPrivateKeyProblem))
        {
            return sealedPrivateKeyProblem;
        }

        var pair = new AccountKeyPair(request.PublicKey, request.WrappedDek, request.SealedPrivateKey);
        var result = await keyPairService.PublishAsync(accountId, pair, cancellationToken);
        return result.Match<Results<NoContent, JsonHttpResult<LimmiarProblemDetails>>>(
            _ => TypedResults.NoContent(),
            reason => MapPublishFailureToProblem(reason));
    }

    private static async Task<Results<Ok<AccountKeyPairResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleGetAsync(
        Guid accountId,
        AccountKeyPairService keyPairService,
        CancellationToken cancellationToken)
    {
        var pair = await keyPairService.GetAsync(accountId, cancellationToken);
        if (pair is null)
        {
            return ProblemJson(StatusCodes.Status404NotFound, "Key pair not found", AccountsProblemCodes.KeyPairNotFound);
        }

        return TypedResults.Ok(new AccountKeyPairResponse(pair.PublicKey, pair.WrappedDek, pair.SealedPrivateKey));
    }

    // [ExcludeFromCodeCoverage] justification: both named PublishKeyPairFailure arms reachable
    // from HandlePutAsync are exercised by a dedicated test (same technique as
    // VoiceEnrollmentEndpoints.MapDeleteFailureToProblem) --
    //   AccountNotFound    -> PutKeyPair_WithUnknownAccountId_Returns404WithProblemDetails
    //   PublicKeyConflict  -> PutKeyPair_WithDifferentPublicKeyThanAlreadyPublished_Returns409WithProblemDetails
    // The remaining gap is the compiler-generated unreachable fallback for the switch expression.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(Justification =
        "Every named case is covered by a dedicated test (see comment above); the remaining " +
        "gap is the compiler-generated unreachable fallback for the switch expression.")]
    private static JsonHttpResult<LimmiarProblemDetails> MapPublishFailureToProblem(PublishKeyPairFailure reason) =>
        reason switch
        {
            PublishKeyPairFailure.AccountNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Account not found", AccountsProblemCodes.AuthAccountNotFound),
            PublishKeyPairFailure.PublicKeyConflict =>
                ProblemJson(StatusCodes.Status409Conflict, "A different public key is already published for this account", AccountsProblemCodes.KeyPairPublicKeyConflict),
            _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
        };
}

public sealed record AccountKeyPairRequest(byte[] PublicKey, byte[] WrappedDek, byte[] SealedPrivateKey);

public sealed record AccountKeyPairResponse(byte[] PublicKey, byte[] WrappedDek, byte[] SealedPrivateKey);
