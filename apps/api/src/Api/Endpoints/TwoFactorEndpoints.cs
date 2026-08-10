using Api.Accounts;
using Api.Problems;
using Api.Serialization;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Api.Endpoints;

// No reset/disable-2FA endpoint by design (ADR-S02-04) -- lost-authenticator recovery is the single-use backup code only. Every handler validates the ITwoFactorTicketIssuer ticket against accountId before calling AccountService.
public static class TwoFactorEndpoints
{
    public static void MapTwoFactorEndpoints(this WebApplication app)
    {
        app.MapPost("/accounts/{accountId:guid}/totp", HandleBeginAsync)
            .WithName("PostAccountTotp")
            .WithSummary("Start (or restart) a mandatory TOTP enrollment")
            .WithDescription("Only for AccountRole.Professional accounts. Calling this again before confirmation replaces the pending secret. Requires a two-factor ticket from register/login/google for this account.")
            .Produces<BeginTotpEnrollmentResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapPost("/accounts/{accountId:guid}/totp/confirm", HandleConfirmAsync)
            .WithName("PostAccountTotpConfirm")
            .WithSummary("Confirm a pending TOTP enrollment")
            .WithDescription("Returns the 10 single-use backup codes in clear text -- the only response that ever exposes them (ADR-S02-04). Requires a two-factor ticket for this account.")
            .Produces<ConfirmTotpEnrollmentResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapPost("/accounts/{accountId:guid}/totp/challenge", HandleChallengeAsync)
            .WithName("PostAccountTotpChallenge")
            .WithSummary("Verify a TOTP code or single-use backup code")
            .WithDescription("Required on every login once 2FA is enabled. Accepts exactly one of code or backupCode. Requires a two-factor ticket for this account.")
            .Produces<LoginResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");
    }

    private static async Task<Results<Ok<BeginTotpEnrollmentResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleBeginAsync(
        Guid accountId, BeginTotpEnrollmentRequest request, AccountService accountService, ITwoFactorTicketIssuer ticketIssuer, CancellationToken cancellationToken)
    {
        if (!ticketIssuer.Validate(request.Ticket, accountId))
        {
            return TicketInvalidProblem();
        }

        var result = await accountService.BeginTotpEnrollmentAsync(accountId, cancellationToken);
        if (!result.Succeeded)
        {
            return result.FailureReason switch
            {
                BeginTotpEnrollmentFailureReason.AccountNotFound =>
                    ProblemJson(StatusCodes.Status404NotFound, "Account not found", ProblemCodes.AuthAccountNotFound),
                BeginTotpEnrollmentFailureReason.NotAProfessionalAccount =>
                    ProblemJson(StatusCodes.Status409Conflict, "Account is not a professional account", ProblemCodes.AuthNotAProfessionalAccount),
                _ => ProblemJson(StatusCodes.Status409Conflict, "TOTP is already enabled for this account", ProblemCodes.AuthTotpAlreadyEnabled),
            };
        }

        return TypedResults.Ok(new BeginTotpEnrollmentResponse(result.Secret!, result.ProvisioningUri!));
    }

    private static async Task<Results<Ok<ConfirmTotpEnrollmentResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleConfirmAsync(
        Guid accountId, ConfirmTotpEnrollmentRequest request, AccountService accountService, ITwoFactorTicketIssuer ticketIssuer, CancellationToken cancellationToken)
    {
        if (!ticketIssuer.Validate(request.Ticket, accountId))
        {
            return TicketInvalidProblem();
        }

        if (string.IsNullOrWhiteSpace(request.Code))
        {
            return ValidationProblem("code");
        }

        var result = await accountService.ConfirmTotpEnrollmentAsync(accountId, request.Code, cancellationToken);
        if (!result.Succeeded)
        {
            return result.FailureReason switch
            {
                ConfirmTotpEnrollmentFailureReason.AccountNotFound =>
                    ProblemJson(StatusCodes.Status404NotFound, "Account not found", ProblemCodes.AuthAccountNotFound),
                ConfirmTotpEnrollmentFailureReason.NotPending =>
                    ProblemJson(StatusCodes.Status409Conflict, "No pending TOTP enrollment for this account", ProblemCodes.AuthTotpNotPending),
                _ => ProblemJson(StatusCodes.Status409Conflict, "Invalid TOTP code", ProblemCodes.AuthTotpInvalidCode),
            };
        }

        ticketIssuer.Invalidate(request.Ticket);
        var session = result.Session!;
        return TypedResults.Ok(new ConfirmTotpEnrollmentResponse(
            result.BackupCodes!, session.AccessToken, session.RefreshToken, session.AccessTokenExpiresAt));
    }

    private static async Task<Results<Ok<LoginResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleChallengeAsync(
        Guid accountId, TotpChallengeRequest request, AccountService accountService, ITwoFactorTicketIssuer ticketIssuer, CancellationToken cancellationToken)
    {
        if (!ticketIssuer.Validate(request.Ticket, accountId))
        {
            return TicketInvalidProblem();
        }

        if (string.IsNullOrWhiteSpace(request.Code) && string.IsNullOrWhiteSpace(request.BackupCode))
        {
            return ValidationProblem("code");
        }

        var result = await accountService.VerifyTotpChallengeAsync(accountId, request.Code, request.BackupCode, cancellationToken);
        if (!result.Succeeded)
        {
            return result.FailureReason switch
            {
                VerifyTotpChallengeFailureReason.AccountNotFound =>
                    ProblemJson(StatusCodes.Status404NotFound, "Account not found", ProblemCodes.AuthAccountNotFound),
                VerifyTotpChallengeFailureReason.NotEnabled =>
                    ProblemJson(StatusCodes.Status409Conflict, "TOTP was never enabled for this account", ProblemCodes.AuthTotpNotEnabled),
                _ => ProblemJson(StatusCodes.Status401Unauthorized, "Invalid TOTP code or backup code", ProblemCodes.AuthTotpInvalidCode),
            };
        }

        ticketIssuer.Invalidate(request.Ticket);

        var account = result.Account!;
        var session = result.Session!;
        return TypedResults.Ok(new LoginResponse(
            account.Id, account.Email, account.Role, TwoFactorPolicy.Determine(account), TwoFactorTicket: null,
            session.AccessToken, session.RefreshToken, session.AccessTokenExpiresAt));
    }

    private static JsonHttpResult<LimmiarProblemDetails> TicketInvalidProblem() =>
        ProblemJson(StatusCodes.Status401Unauthorized, "Invalid or missing two-factor ticket", ProblemCodes.AuthTotpTicketInvalid);

    private static JsonHttpResult<LimmiarProblemDetails> ValidationProblem(string field) =>
        ProblemJson(
            StatusCodes.Status400BadRequest,
            "Invalid request",
            ProblemCodes.ValidationInvalidField,
            new Dictionary<string, string> { ["field"] = field });

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

public sealed record BeginTotpEnrollmentRequest(string Ticket);

public sealed record BeginTotpEnrollmentResponse(string Secret, string ProvisioningUri);

public sealed record ConfirmTotpEnrollmentRequest(string Ticket, string Code);

// The only response in the API that ever exposes the backup codes in clear -- ADR-S02-04.
public sealed record ConfirmTotpEnrollmentResponse(
    IReadOnlyList<string> BackupCodes, string AccessToken, string RefreshToken, DateTimeOffset AccessTokenExpiresAt);

public sealed record TotpChallengeRequest(string Ticket, string? Code, string? BackupCode);
