using Api.Accounts;
using Api.Problems;
using Api.Serialization;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints;

/// <summary>
/// S02-02 backend: comprovação profissional (CRP/CRM auto-verificado, documento em fila
/// de revisão humana). Owns request validation and HTTP status/Problem+JSON mapping; all
/// domain logic lives in <see cref="AccountService"/>, which this class only calls into --
/// same split as <see cref="AuthEndpoints"/>.
///
/// Security-review fix: <see cref="HandleListQueueAsync"/> and <see cref="HandleDecideAsync"/>
/// are exclusively human-reviewer/staff actions, but had no authentication at all -- any
/// professional could approve their own document review by calling the decision endpoint
/// on their own account. This backend has no staff/admin account concept yet (Spec S02
/// marks team invites/RBAC as Out of Scope, owned by S14), so both handlers now require a
/// shared-secret <c>X-Staff-Api-Key</c> header, checked via <see cref="IStaffAccessGuard"/>
/// -- a minimal containment stopgap, not real RBAC.
///
/// Second security-review fix (found while implementing S02-08, applied retroactively --
/// confirmed with the human before touching this already-Done ticket's endpoint):
/// <see cref="HandleSubmitAsync"/> had the exact same class of bug as the two handlers
/// above -- it trusted the <c>accountId</c> URL segment alone, with no proof the caller
/// was ever authenticated as that account. A caller who merely knew (or guessed) a
/// professional's account id could submit a forged credential on that professional's
/// behalf, driving their <see cref="Account.VerificationStatus"/> through the reviewer
/// queue. Now gated by the <c>Authorization: Bearer &lt;access token&gt;</c> issued by
/// S02-08's <see cref="ISessionTokenIssuer"/> -- the first real consumer of
/// <see cref="ISessionTokenIssuer.ValidateAccess"/>, which existed as a ready seam with no
/// caller until now (see that method's own doc comment).
/// </summary>
public static class ProfessionalVerificationEndpoints
{
    public static void MapProfessionalVerificationEndpoints(this WebApplication app)
    {
        app.MapPost("/accounts/{accountId:guid}/professional-verification", HandleSubmitAsync)
            .WithName("PostProfessionalVerification")
            .WithSummary("Submit (or resubmit) a professional credential")
            .WithDescription("CRP/CRM are auto-verified and resolve immediately; a document goes to human review (SLA declared in the response). Requires an Authorization: Bearer access token for this exact account.")
            .Produces<SubmitProfessionalCredentialResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapGet("/accounts/professional-verification/queue", HandleListQueueAsync)
            .WithName("GetProfessionalVerificationQueue")
            .WithSummary("List professional accounts awaiting document review")
            .WithDescription("Oldest submission first, so the declared SLA clock is respected. Staff-only: requires the X-Staff-Api-Key header.")
            .Produces<IReadOnlyList<ProfessionalVerificationQueueEntry>>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json");

        app.MapPost("/accounts/{accountId:guid}/professional-verification/decision", HandleDecideAsync)
            .WithName("PostProfessionalVerificationDecision")
            .WithSummary("Approve or reject a queued document submission")
            .WithDescription("Only valid while the account is InReview. Rejection carries a reader-facing reason. Staff-only: requires the X-Staff-Api-Key header.")
            .Produces<ProfessionalVerificationDecisionResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");
    }

    private static async Task<Results<Ok<SubmitProfessionalCredentialResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleSubmitAsync(
        Guid accountId,
        SubmitProfessionalCredentialRequest request,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        AccountService accountService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        if (!TryValidateSubmission(request, out var validationProblem))
        {
            return validationProblem;
        }

        var result = await accountService.SubmitProfessionalCredentialAsync(
            accountId, request.Type, request.RegistryNumber, request.RegistryUf, request.DocumentReference, cancellationToken);

        if (!result.Succeeded)
        {
            return result.FailureReason switch
            {
                SubmitProfessionalCredentialFailureReason.AccountNotFound =>
                    ProblemJson(StatusCodes.Status404NotFound, "Account not found", ProblemCodes.AuthAccountNotFound),
                SubmitProfessionalCredentialFailureReason.NotAProfessionalAccount =>
                    ProblemJson(StatusCodes.Status409Conflict, "Account is not a professional account", ProblemCodes.AuthNotAProfessionalAccount),
                _ => ProblemJson(StatusCodes.Status409Conflict, "Account cannot submit a credential in its current state", ProblemCodes.AuthInvalidVerificationState),
            };
        }

        var account = result.Account!;
        return TypedResults.Ok(new SubmitProfessionalCredentialResponse(
            account.Id, account.VerificationStatus, account.RejectionReason, result.DocumentReviewSlaBusinessDays));
    }

    private static async Task<Results<Ok<IReadOnlyList<ProfessionalVerificationQueueEntry>>, JsonHttpResult<LimmiarProblemDetails>>> HandleListQueueAsync(
        [FromHeader(Name = "X-Staff-Api-Key")] string? staffApiKey, IStaffAccessGuard staffAccessGuard, AccountService accountService, CancellationToken cancellationToken)
    {
        if (!staffAccessGuard.IsAuthorized(staffApiKey))
        {
            return StaffUnauthorizedProblem();
        }

        var queue = await accountService.ListPendingProfessionalVerificationsAsync(cancellationToken);
        IReadOnlyList<ProfessionalVerificationQueueEntry> entries = queue
            .Select(account => new ProfessionalVerificationQueueEntry(account.Id, account.Email, account.VerificationSubmittedAt!.Value))
            .ToList();
        return TypedResults.Ok(entries);
    }

    private static async Task<Results<Ok<ProfessionalVerificationDecisionResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleDecideAsync(
        Guid accountId,
        ProfessionalVerificationDecisionRequest request,
        [FromHeader(Name = "X-Staff-Api-Key")] string? staffApiKey,
        IStaffAccessGuard staffAccessGuard,
        AccountService accountService,
        CancellationToken cancellationToken)
    {
        if (!staffAccessGuard.IsAuthorized(staffApiKey))
        {
            return StaffUnauthorizedProblem();
        }

        if (!request.Approved && string.IsNullOrWhiteSpace(request.RejectionReason))
        {
            return ValidationProblem("rejectionReason");
        }

        var result = await accountService.DecideProfessionalVerificationAsync(
            accountId, request.Approved, request.RejectionReason, cancellationToken);

        if (!result.Succeeded)
        {
            return result.FailureReason switch
            {
                ProfessionalVerificationDecisionFailureReason.AccountNotFound =>
                    ProblemJson(StatusCodes.Status404NotFound, "Account not found", ProblemCodes.AuthAccountNotFound),
                _ => ProblemJson(StatusCodes.Status409Conflict, "Account is not awaiting review", ProblemCodes.AuthNotInReview),
            };
        }

        var account = result.Account!;
        return TypedResults.Ok(new ProfessionalVerificationDecisionResponse(account.Id, account.VerificationStatus, account.RejectionReason));
    }

    /// <summary>
    /// CRP/CRM require a registry number + UF; a document requires a reference. A
    /// malformed request (wrong fields for the chosen type) is a 400 validation error --
    /// distinct from the 409s <see cref="AccountService.SubmitProfessionalCredentialAsync"/>
    /// returns for a well-formed request the account's state doesn't allow.
    /// </summary>
    private static bool TryValidateSubmission(
        SubmitProfessionalCredentialRequest request, out JsonHttpResult<LimmiarProblemDetails> problem)
    {
        if (request.Type is ProfessionalCredentialType.Crp or ProfessionalCredentialType.Crm)
        {
            if (string.IsNullOrWhiteSpace(request.RegistryNumber))
            {
                problem = ValidationProblem("registryNumber");
                return false;
            }

            if (string.IsNullOrWhiteSpace(request.RegistryUf))
            {
                problem = ValidationProblem("registryUf");
                return false;
            }
        }
        else if (string.IsNullOrWhiteSpace(request.DocumentReference))
        {
            problem = ValidationProblem("documentReference");
            return false;
        }

        problem = default!;
        return true;
    }

    private static JsonHttpResult<LimmiarProblemDetails> ValidationProblem(string field) =>
        ProblemJson(
            StatusCodes.Status400BadRequest,
            "Invalid request",
            ProblemCodes.ValidationInvalidField,
            new Dictionary<string, string> { ["field"] = field });

    private static JsonHttpResult<LimmiarProblemDetails> StaffUnauthorizedProblem() =>
        ProblemJson(StatusCodes.Status401Unauthorized, "Missing or invalid staff API key", ProblemCodes.StaffUnauthorized);

    /// <summary>
    /// True only if <paramref name="authorizationHeader"/> is a well-formed
    /// <c>Bearer &lt;token&gt;</c> value whose token <see cref="ISessionTokenIssuer.ValidateAccess"/>
    /// resolves to EXACTLY <paramref name="accountId"/> -- a valid access token for a
    /// DIFFERENT account must not authorize this call (same account-scoping discipline as
    /// <see cref="Accounts.ITwoFactorTicketIssuer.Validate"/>).
    /// </summary>
    private const string BearerPrefix = "Bearer ";

    private static bool IsAuthorizedForAccount(string? authorizationHeader, Guid accountId, ISessionTokenIssuer sessionTokenIssuer)
    {
        if (authorizationHeader is null || !authorizationHeader.StartsWith(BearerPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        var accessToken = authorizationHeader[BearerPrefix.Length..];
        return sessionTokenIssuer.ValidateAccess(accessToken) == accountId;
    }

    private static JsonHttpResult<LimmiarProblemDetails> AccessTokenUnauthorizedProblem() =>
        ProblemJson(StatusCodes.Status401Unauthorized, "Missing or invalid access token", ProblemCodes.AuthAccessTokenInvalid);

    private static JsonHttpResult<LimmiarProblemDetails> ProblemJson(
        int status, string title, string code, Dictionary<string, string>? paramsDict = null)
    {
        var problem = new LimmiarProblemDetails
        {
            Status = status,
            Title = title,
            Code = code,
            Params = paramsDict ?? new Dictionary<string, string>(),
        };

        return TypedResults.Json(
            problem,
            ApiJsonSerializerContext.Default.LimmiarProblemDetails,
            contentType: "application/problem+json",
            statusCode: status);
    }
}

/// <summary>One entry in the human review queue -- deliberately narrower than <see cref="Account"/> (no credential material, no verifier).</summary>
public sealed record ProfessionalVerificationQueueEntry(Guid AccountId, string Email, DateTimeOffset SubmittedAt);
