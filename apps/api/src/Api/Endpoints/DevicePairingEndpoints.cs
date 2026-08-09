using Api.Accounts;
using Api.Problems;
using Api.Serialization;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints;

/// <summary>
/// S02-04 backend: the HTTP surface of the device-pairing-by-QR handshake. Owns
/// authentication and HTTP status/Problem+JSON mapping only; the entire handshake --
/// session lifetime, first-claim-wins, single-use payload delivery -- lives in
/// <see cref="IDevicePairingIssuer"/>, which every handler here calls exactly once. Same
/// split as <see cref="AuthEndpoints"/>/<see cref="TwoFactorEndpoints"/>.
///
/// Two of the five endpoints are deliberately unauthenticated (claim, fetch payload): the
/// scanning device has no session for this account yet -- that is the whole point of
/// pairing -- so possession of the session id it just read off the QR code, plus having won
/// the single claim that id allows, IS its credential. The other three are account-scoped
/// exactly like <see cref="ProfessionalVerificationEndpoints"/>'s submit handler: an
/// <c>Authorization: Bearer</c> access token that <see cref="ISessionTokenIssuer.ValidateAccess"/>
/// resolves to the <c>accountId</c> URL segment and no other.
/// </summary>
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

    /// <summary>
    /// Synchronous, unlike <see cref="HandleSubmitPayload"/> below: <see cref="IDevicePairingIssuer"/>
    /// is an in-memory relay with no I/O to await, so wrapping these handlers in <c>Task</c>
    /// would buy nothing on its own. <see cref="HandleSubmitPayload"/> is the one exception
    /// among the five -- it also awaits <see cref="AccountService.NotifyNewDeviceLinkedAsync"/>
    /// to fire the S02-07 new-device alert once the handshake completes, which is why it alone
    /// needs to be <c>async Task</c>.
    /// </summary>
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
                // NotClaimedYet and AlreadySubmitted alike: the session is real and the
                // caller owns it, it just cannot take a payload right now.
                _ => ProblemJson(StatusCodes.Status409Conflict, "Pairing session is not ready for a payload", ProblemCodes.DevicePairingPayloadNotReady),
            };
        }

        // S02-07: the handshake just finished -- alert the account holder out-of-band.
        // AccountService.NotifyNewDeviceLinkedAsync already swallows its own failures, so this
        // call can never turn a successful handshake into a non-204 response.
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

    private const string BearerPrefix = "Bearer ";

    /// <summary>
    /// True only if <paramref name="authorizationHeader"/> is a well-formed
    /// <c>Bearer &lt;token&gt;</c> value whose token <see cref="ISessionTokenIssuer.ValidateAccess"/>
    /// resolves to EXACTLY <paramref name="accountId"/> -- a valid access token for a
    /// DIFFERENT account must not authorize the call (same account-scoping discipline, and
    /// the same check, as <see cref="ProfessionalVerificationEndpoints"/>).
    /// </summary>
    private static bool IsAuthorizedForAccount(string? authorizationHeader, Guid accountId, ISessionTokenIssuer sessionTokenIssuer)
    {
        if (authorizationHeader is null || !authorizationHeader.StartsWith(BearerPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        var accessToken = authorizationHeader[BearerPrefix.Length..];
        return sessionTokenIssuer.ValidateAccess(accessToken) == accountId;
    }

    private static JsonHttpResult<LimmiarProblemDetails> SessionNotFoundProblem() =>
        ProblemJson(StatusCodes.Status404NotFound, "Pairing session not found", ProblemCodes.DevicePairingSessionNotFound);

    private static JsonHttpResult<LimmiarProblemDetails> AccessTokenUnauthorizedProblem() =>
        ProblemJson(StatusCodes.Status401Unauthorized, "Missing or invalid access token", ProblemCodes.AuthAccessTokenInvalid);

    private static JsonHttpResult<LimmiarProblemDetails> ProblemJson(int status, string title, string code)
    {
        var problem = new LimmiarProblemDetails
        {
            Status = status,
            Title = title,
            Code = code,
            Params = new Dictionary<string, string>(),
        };

        return TypedResults.Json(
            problem,
            ApiJsonSerializerContext.Default.LimmiarProblemDetails,
            contentType: "application/problem+json",
            statusCode: status);
    }
}

/// <summary>
/// <see cref="PrimaryPublicKey"/> is the already-authorized device's raw X25519 public key,
/// carried as base64 over JSON -- same <c>byte[]</c>-property convention as
/// <see cref="Accounts.RegisterRequest.PasswordVerifier"/>. Opaque to this backend, which
/// only relays it.
/// </summary>
public sealed record CreatePairingSessionRequest(byte[] PrimaryPublicKey);

/// <summary>
/// <see cref="SessionId"/> is what the primary device encodes into its QR code. Opaque --
/// callers must not attempt to decode or interpret it. It stops working at
/// <see cref="ExpiresAt"/>, which the primary uses to expire the code on screen.
/// </summary>
public sealed record CreatePairingSessionResponse(string SessionId, DateTimeOffset ExpiresAt);

/// <summary>
/// <see cref="NewDevicePublicKey"/> is the scanning device's own raw X25519 public key --
/// what the primary will encrypt its KEK for. Base64 over JSON, same convention as
/// <see cref="CreatePairingSessionRequest.PrimaryPublicKey"/>.
/// </summary>
public sealed record ClaimPairingSessionRequest(byte[] NewDevicePublicKey);

/// <summary>The primary device's raw X25519 public key, so the claiming device can derive the shared secret for this pairing.</summary>
public sealed record ClaimPairingSessionResponse(byte[] PrimaryPublicKey);

/// <summary>
/// <see cref="Claimed"/> is false while the session is still waiting for a device to scan
/// the QR code; <see cref="NewDevicePublicKey"/> is null until it is true, and is the key
/// the primary encrypts its KEK for.
/// </summary>
public sealed record PairingClaimStatusResponse(bool Claimed, byte[]? NewDevicePublicKey);

/// <summary>
/// <see cref="EncryptedKek"/> is the primary's KEK, already encrypted to the claiming
/// device's key. Base64 over JSON, and completely opaque to this backend -- it never has
/// the material to read it and relays it verbatim.
/// </summary>
public sealed record SubmitPairingPayloadRequest(byte[] EncryptedKek);

/// <summary>
/// The ciphertext relayed to the claiming device, byte-for-byte as the primary submitted
/// it. Delivered exactly once -- see <see cref="IDevicePairingIssuer.FetchPayload"/>.
/// </summary>
public sealed record PairingSessionPayloadResponse(byte[] EncryptedKek);
