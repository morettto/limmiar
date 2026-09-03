using Api.Accounts;
using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using static Api.Accounts.AccountsProblemResults;
using static Api.Accounts.SessionTokenIssuerAuthorization;
using static Api.Problems.ProblemResults;
using static Api.Problems.SealedBlobShape;

namespace Api.Notes;

public static class NoteEndpoints
{
    public static void MapNoteEndpoints(this WebApplication app)
    {
        app.MapPost("/accounts/{accountId:guid}/notes/{noteId:guid}/signature", HandleSignAsync)
            .WithName("PostNoteSignature")
            .WithSummary("Sign a note")
            .WithDescription("Persists a client-sealed signature blob (iv(12) || AES-GCM(digest SHA-256 da nota)(32) || tag(16), 60 bytes) for one (accountId, noteId) pair, once. The Postgres primary key on (tenant_id, note_id) -- not application logic -- is what actually enforces one signature per note; a second attempt is 409 notes.already_signed. Requires an Authorization: Bearer access token for this exact account, and the account must be an active Professional (same guard as Patients).")
            .Produces<SignNoteResponse>(StatusCodes.Status201Created)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapGet("/accounts/{accountId:guid}/notes/{noteId:guid}/signature", HandleGetAsync)
            .WithName("GetNoteSignature")
            .WithSummary("Read a note's signature")
            .WithDescription("Exists so the trava (lock) a signed note enforces is imposed by the server, not only remembered in the browser and lost on reload. Requires an Authorization: Bearer access token for this exact account.")
            .Produces<NoteSignatureResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");
    }

    private static async Task<Results<Created<SignNoteResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleSignAsync(
        Guid accountId,
        Guid noteId,
        SignNoteRequest request,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        NoteService noteService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        if (!TryValidateSealedBlobShape(request.Signature, "signature", out var signatureProblem))
        {
            return signatureProblem;
        }

        if (request.Revisao < 0)
        {
            return ValidationProblem("revisao");
        }

        var result = await noteService.SignAsync(accountId, noteId, request.Revisao, request.Signature, cancellationToken);
        if (!result.TryGetValue(out var signature, out var failureReason))
        {
            return MapFailureToProblem(failureReason);
        }

        return TypedResults.Created(
            $"/accounts/{accountId}/notes/{noteId}/signature",
            new SignNoteResponse(noteId, signature.Revisao, signature.SignedAt));
    }

    private static async Task<Results<Ok<NoteSignatureResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleGetAsync(
        Guid accountId,
        Guid noteId,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        NoteService noteService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        var signature = await noteService.GetSignatureAsync(accountId, noteId, cancellationToken);
        if (signature is null)
        {
            return ProblemJson(StatusCodes.Status404NotFound, "Note signature not found", NotesProblemCodes.NotesSignatureNotFound);
        }

        return TypedResults.Ok(new NoteSignatureResponse(noteId, signature.Revisao, signature.Signature, signature.SignedAt));
    }

    // [ExcludeFromCodeCoverage] justification (ronda 1 de correção): every named
    // SignNoteFailureReason arm is exercised by a dedicated HTTP-layer test, same session-bypass
    // technique as PatientEndpoints.MapCreateFailureToProblem --
    //   AccountNotFound              -> PostNoteSignature_WithUnknownAccountId_Returns404WithProblemDetails
    //   NotAuthorizedToCreateRecords -> PostNoteSignature_WithUnverifiedProfessional_Returns403WithProblemDetails
    //   AlreadySigned                 -> PostNoteSignature_ForAlreadySignedNote_Returns409WithProblemDetails
    // Before this round, AccountNotFound/NotAuthorizedToCreateRecords were only proven at the
    // NoteService layer (NoteServiceTests), never through this HTTP mapping -- the two branches
    // this endpoint's status code and problem `code` depend on were unexercised at the level a
    // caller actually observes them. The remaining gap is the compiler-generated unreachable
    // fallback for the switch expression, same reasoning as PatientEndpoints.MapCreateFailureToProblem.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(Justification =
        "Every named case is covered by a dedicated HTTP test (see comment above); the " +
        "remaining gap is the compiler-generated unreachable fallback for the switch " +
        "expression.")]
    private static JsonHttpResult<LimmiarProblemDetails> MapFailureToProblem(SignNoteFailureReason reason) =>
        reason switch
        {
            SignNoteFailureReason.AccountNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Account not found", AccountsProblemCodes.AuthAccountNotFound),
            SignNoteFailureReason.NotAuthorizedToCreateRecords =>
                ProblemJson(StatusCodes.Status403Forbidden, "Account is not authorized to sign notes", NotesProblemCodes.NotesNotAuthorizedToSign),
            SignNoteFailureReason.AlreadySigned =>
                ProblemJson(StatusCodes.Status409Conflict, "Note already signed", NotesProblemCodes.NotesAlreadySigned),
            _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
        };
}

public sealed record SignNoteRequest(int Revisao, byte[] Signature);

public sealed record SignNoteResponse(Guid NoteId, int Revisao, DateTimeOffset SignedAt);

public sealed record NoteSignatureResponse(Guid NoteId, int Revisao, byte[] Signature, DateTimeOffset SignedAt);
