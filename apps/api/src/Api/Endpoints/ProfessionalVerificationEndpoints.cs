using Api.Accounts;
using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using static Api.Endpoints.EndpointHelpers;

namespace Api.Endpoints;

// HandleListQueueAsync/HandleDecideAsync are staff-only (X-Staff-Api-Key, IStaffAccessGuard); HandleSubmitAsync is account-scoped via Bearer access token -- both gates closed security-review findings against forged/unauthenticated calls.
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

    private static JsonHttpResult<LimmiarProblemDetails> StaffUnauthorizedProblem() =>
        ProblemJson(StatusCodes.Status401Unauthorized, "Missing or invalid staff API key", ProblemCodes.StaffUnauthorized);
}

public sealed record ProfessionalVerificationQueueEntry(Guid AccountId, string Email, DateTimeOffset SubmittedAt);
