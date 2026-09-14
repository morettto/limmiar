using Api.Accounts;
using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using static Api.Problems.ProblemResults;

namespace Api.PatientLinks;

public static class PatientLinkEndpoints
{
    public static void MapPatientLinkEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/accounts/{accountId:guid}/patients/{patientId:guid}/link-invites", HandleCreateInviteAsync)
            .WithName("CreateLinkInvite")
            .WithSummary("Generate a single-use code linking a patientId to a paciente account")
            .WithDescription("The code is 12 Crockford-Base32 characters (60 bits), single use, expires after 7 days (PatientLinkStore.InviteLifetime). Requires an Authorization: Bearer access token for this exact account, and the account must be an active Professional (same guard as Consent/Notes).")
            .Produces<CreateLinkInviteResponse>(StatusCodes.Status201Created)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");

        app.MapPost("/accounts/{accountId:guid}/links", HandleRedeemAsync)
            .WithName("RedeemLinkInvite")
            .WithSummary("Redeem a single-use code, creating the link")
            .WithDescription("Consumes the invite on success only. 409 if this professional-patient pair (by account or by patientId) is already linked. Requires an Authorization: Bearer access token for this exact account, and the account must be a Patient.")
            .Produces<LinkView>(StatusCodes.Status201Created)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapGet("/accounts/{accountId:guid}/links", HandleListAsync)
            .WithName("ListLinks")
            .WithSummary("List this account's links, each with the peer's public key")
            .WithDescription("The only response in this API that carries another account's public key -- always the caller's own links, never a third party's. peerPublicKey is null if the peer never published a key pair yet.")
            .Produces<IReadOnlyList<LinkView>>(StatusCodes.Status200OK);

        app.MapDelete("/accounts/{accountId:guid}/links/{peerAccountId:guid}", HandleUnlink)
            .WithName("Unlink")
            .WithSummary("Remove the link between this account and the peer")
            .WithDescription("Either party may unlink. Does not touch key pairs or anything already shared. 404 if no link exists between the two accounts -- not a silent no-op 204.")
            .Produces(StatusCodes.Status204NoContent)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");
    }

    private static async Task<Results<Created<CreateLinkInviteResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleCreateInviteAsync(
        Guid accountId,
        Guid patientId,
        PatientLinkService linkService,
        CancellationToken cancellationToken)
    {
        var result = await linkService.CreateInviteAsync(accountId, patientId, cancellationToken);
        return result.Match<Results<Created<CreateLinkInviteResponse>, JsonHttpResult<LimmiarProblemDetails>>>(
            invite => TypedResults.Created(
                $"/accounts/{accountId}/patients/{patientId}/link-invites",
                new CreateLinkInviteResponse(invite.Code, invite.ExpiresAt)),
            reason => MapCreateInviteFailureToProblem(reason));
    }

    private static async Task<Results<Created<LinkView>, JsonHttpResult<LimmiarProblemDetails>>> HandleRedeemAsync(
        Guid accountId,
        RedeemLinkRequest request,
        PatientLinkService linkService,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(request.Code))
        {
            return ValidationProblem("code");
        }

        var result = await linkService.RedeemAsync(accountId, request.Code, cancellationToken);
        return result.Match<Results<Created<LinkView>, JsonHttpResult<LimmiarProblemDetails>>>(
            view => TypedResults.Created($"/accounts/{accountId}/links", view),
            reason => MapRedeemFailureToProblem(reason));
    }

    private static async Task<Results<Ok<IReadOnlyList<LinkView>>, JsonHttpResult<LimmiarProblemDetails>>> HandleListAsync(
        Guid accountId,
        PatientLinkService linkService,
        CancellationToken cancellationToken)
    {
        var links = await linkService.ListAsync(accountId, cancellationToken);
        return TypedResults.Ok(links);
    }

    private static Results<NoContent, JsonHttpResult<LimmiarProblemDetails>> HandleUnlink(
        Guid accountId,
        Guid peerAccountId,
        PatientLinkService linkService)
    {
        if (!linkService.Unlink(accountId, peerAccountId))
        {
            return ProblemJson(StatusCodes.Status404NotFound, "Link not found", PatientLinksProblemCodes.LinkNotFound);
        }

        return TypedResults.NoContent();
    }

    // [ExcludeFromCodeCoverage] justification: both named CreateInviteFailure arms reachable
    // from HandleCreateInviteAsync are exercised by a dedicated test (same technique as
    // ConsentEndpoints.MapFailureToProblem) --
    //   AccountNotFound -> CreateInvite_WithUnknownAccountId_Returns404WithProblemDetails
    //   NotAuthorized   -> CreateInvite_ByUnverifiedProfessional_Returns403WithProblemDetails
    // The remaining gap is the compiler-generated unreachable fallback for the switch expression.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(Justification =
        "Every named case is covered by a dedicated test (see comment above); the remaining " +
        "gap is the compiler-generated unreachable fallback for the switch expression.")]
    private static JsonHttpResult<LimmiarProblemDetails> MapCreateInviteFailureToProblem(CreateInviteFailure reason) =>
        reason switch
        {
            CreateInviteFailure.AccountNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Account not found", AccountsProblemCodes.AuthAccountNotFound),
            CreateInviteFailure.NotAuthorized =>
                ProblemJson(StatusCodes.Status403Forbidden, "Account is not authorized to create link invites", PatientLinksProblemCodes.LinkNotAuthorized),
            _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
        };

    // [ExcludeFromCodeCoverage] justification: every named RedeemLinkFailure arm reachable from
    // HandleRedeemAsync is exercised by a dedicated test --
    //   AccountNotFound -> Redeem_WithUnknownAccountId_Returns404WithProblemDetails
    //   NotAPatient     -> Redeem_ByProfessionalAccount_Returns403WithProblemDetails
    //   InviteNotFound  -> Redeem_WithUnknownCode_Returns404WithProblemDetails
    //   AlreadyLinked   -> Redeem_WhenAlreadyLinked_Returns409WithProblemDetails
    // The remaining gap is the compiler-generated unreachable fallback for the switch expression.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(Justification =
        "Every named case is covered by a dedicated test (see comment above); the remaining " +
        "gap is the compiler-generated unreachable fallback for the switch expression.")]
    private static JsonHttpResult<LimmiarProblemDetails> MapRedeemFailureToProblem(RedeemLinkFailure reason) =>
        reason switch
        {
            RedeemLinkFailure.AccountNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Account not found", AccountsProblemCodes.AuthAccountNotFound),
            RedeemLinkFailure.NotAPatient =>
                ProblemJson(StatusCodes.Status403Forbidden, "Account is not a patient", PatientLinksProblemCodes.LinkNotAuthorized),
            RedeemLinkFailure.InviteNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Link invite not found", PatientLinksProblemCodes.LinkInviteNotFound),
            RedeemLinkFailure.AlreadyLinked =>
                ProblemJson(StatusCodes.Status409Conflict, "Accounts are already linked", PatientLinksProblemCodes.LinkAlreadyLinked),
            _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
        };
}

public sealed record CreateLinkInviteResponse(string Code, DateTimeOffset ExpiresAt);

public sealed record RedeemLinkRequest(string Code);
