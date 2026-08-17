using Api.Accounts;
using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using static Api.Endpoints.EndpointHelpers;

namespace Api.Endpoints;

public static class DevicePairingEndpoints
{
    public static void MapDevicePairingEndpoints(this WebApplication app)
    {
        app.MapPost("/accounts/{accountId:guid}/devices/pairing-sessions", HandleCreate)
            .WithName("PostDevicePairingSession")
            .WithSummary("Open a device-pairing session")
            .WithDescription("Called by the already-authorized device; the returned sessionId is what it encodes into the QR code. Requires an Authorization: Bearer access token for this exact account.")
            .Produces<CreatePairingSessionResponse>(StatusCodes.Status201Created)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json");

        app.MapPost("/devices/pairing-sessions/{sessionId}/claim", HandleClaim)
            .WithName("PostDevicePairingSessionClaim")
            .WithSummary("Claim a pairing session by scanning its QR code")
            .WithDescription("Deliberately unauthenticated: the scanning device has no session for this account yet. First caller wins; every later caller gets the same 404 as an unknown session id.")
            .Produces<ClaimPairingSessionResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");

        app.MapGet("/accounts/{accountId:guid}/devices/pairing-sessions/{sessionId}/claim-status", HandleGetClaimStatus)
            .WithName("GetDevicePairingSessionClaimStatus")
            .WithSummary("Poll whether a device has scanned the QR code yet")
            .WithDescription("Consumes nothing, so the primary device can poll it as often as it likes. Requires an Authorization: Bearer access token for this exact account; a session belonging to another account is reported as if it did not exist.")
            .Produces<PairingClaimStatusResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");

        app.MapPost("/accounts/{accountId:guid}/devices/pairing-sessions/{sessionId}/payload", HandleSubmitPayload)
            .WithName("PostDevicePairingSessionPayload")
            .WithSummary("Hand over the KEK encrypted to the claiming device")
            .WithDescription("Valid exactly once, and only after a device has claimed the session. The ciphertext is opaque to this backend. Requires an Authorization: Bearer access token for this exact account.")
            .Produces(StatusCodes.Status204NoContent)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapGet("/devices/pairing-sessions/{sessionId}/payload", HandleFetchPayload)
            .WithName("GetDevicePairingSessionPayload")
            .WithSummary("Collect the encrypted KEK as the claiming device")
            .WithDescription("Deliberately unauthenticated, same as claim: the new device has no session for this account yet. Valid exactly once -- a successful fetch consumes the session. Callers poll this until it returns 200.")
            .Produces<PairingSessionPayloadResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");
    }

    // The one async handler of the five -- it alone awaits AccountService.NotifyNewDeviceLinkedAsync (S02-07 alert) after the handshake completes.
    private static Results<Created<CreatePairingSessionResponse>, JsonHttpResult<LimmiarProblemDetails>> HandleCreate(
        Guid accountId,
        CreatePairingSessionRequest request,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        IDevicePairingIssuer pairingIssuer)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        var (sessionId, expiresAt) = pairingIssuer.Create(accountId, request.PrimaryPublicKey);
        return TypedResults.Created(
            $"/devices/pairing-sessions/{sessionId}",
            new CreatePairingSessionResponse(sessionId, expiresAt));
    }

    private static Results<Ok<ClaimPairingSessionResponse>, JsonHttpResult<LimmiarProblemDetails>> HandleClaim(
        string sessionId,
        ClaimPairingSessionRequest request,
        IDevicePairingIssuer pairingIssuer)
    {
        var result = pairingIssuer.Claim(sessionId, request.NewDevicePublicKey);
        if (!result.Succeeded)
        {
            return SessionNotFoundProblem();
        }

        return TypedResults.Ok(new ClaimPairingSessionResponse(result.PrimaryPublicKey!));
    }

    private static Results<Ok<PairingClaimStatusResponse>, JsonHttpResult<LimmiarProblemDetails>> HandleGetClaimStatus(
        Guid accountId,
        string sessionId,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        IDevicePairingIssuer pairingIssuer)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        var result = pairingIssuer.GetClaimStatus(sessionId, accountId);
        if (!result.Succeeded)
        {
            return SessionNotFoundProblem();
        }

        return TypedResults.Ok(new PairingClaimStatusResponse(result.Claimed, result.NewDevicePublicKey));
    }

    private static async Task<Results<NoContent, JsonHttpResult<LimmiarProblemDetails>>> HandleSubmitPayload(
        Guid accountId,
        string sessionId,
        SubmitPairingPayloadRequest request,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        IDevicePairingIssuer pairingIssuer,
        AccountService accountService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        var result = pairingIssuer.SubmitPayload(sessionId, accountId, request.EncryptedKek);
        if (!result.Succeeded)
        {
            return result.FailureReason switch
            {
                SubmitPairingPayloadFailureReason.NotFound => SessionNotFoundProblem(),
                _ => ProblemJson(StatusCodes.Status409Conflict, "Pairing session is not ready for a payload", ProblemCodes.DevicePairingPayloadNotReady),
            };
        }

        await accountService.NotifyNewDeviceLinkedAsync(accountId, cancellationToken);

        return TypedResults.NoContent();
    }

    private static Results<Ok<PairingSessionPayloadResponse>, JsonHttpResult<LimmiarProblemDetails>> HandleFetchPayload(
        string sessionId,
        IDevicePairingIssuer pairingIssuer)
    {
        var result = pairingIssuer.FetchPayload(sessionId);
        if (!result.Succeeded)
        {
            return ProblemJson(
                StatusCodes.Status404NotFound, "No pairing payload to deliver", ProblemCodes.DevicePairingPayloadNotDelivered);
        }

        return TypedResults.Ok(new PairingSessionPayloadResponse(result.EncryptedKek!));
    }

    private static JsonHttpResult<LimmiarProblemDetails> SessionNotFoundProblem() =>
        ProblemJson(StatusCodes.Status404NotFound, "Pairing session not found", ProblemCodes.DevicePairingSessionNotFound);
}

public sealed record CreatePairingSessionRequest(byte[] PrimaryPublicKey);

public sealed record CreatePairingSessionResponse(string SessionId, DateTimeOffset ExpiresAt);

public sealed record ClaimPairingSessionRequest(byte[] NewDevicePublicKey);

public sealed record ClaimPairingSessionResponse(byte[] PrimaryPublicKey);

public sealed record PairingClaimStatusResponse(bool Claimed, byte[]? NewDevicePublicKey);

public sealed record SubmitPairingPayloadRequest(byte[] EncryptedKek);

public sealed record PairingSessionPayloadResponse(byte[] EncryptedKek);
