using Api.Accounts;
using Api.Problems;
using Api.Serialization;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints;

/// <summary>
/// S02-06 backend: BIP39 recovery-phrase account recovery for
/// <see cref="AccountRole.Professional"/> accounts. Owns request validation and HTTP
/// status/Problem+JSON mapping; all domain logic lives in <see cref="AccountService"/>,
/// which this class only calls into -- same split as <see cref="AuthEndpoints"/> and
/// <see cref="ProfessionalVerificationEndpoints"/>. The Bearer-token account-scoping check
/// on <c>POST /accounts/{accountId}/recovery-phrase</c> mirrors
/// <see cref="ProfessionalVerificationEndpoints.HandleSubmitAsync"/> exactly.
/// </summary>
public static class RecoveryEndpoints
{
    public static void MapRecoveryEndpoints(this WebApplication app)
    {
        app.MapPost("/auth/recover", HandleRecoverAsync)
            .WithName("PostAuthRecover")
            .WithSummary("Recover access with a BIP39 recovery phrase")
            .WithDescription("Returns the exact same response (status, code, body) for an unknown e-mail, an account that never registered a recovery phrase, and a wrong verifier -- account enumeration mitigation.")
            .Produces<RecoverAccessResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json");

        app.MapPost("/accounts/{accountId:guid}/recovery-phrase", HandleRegisterRecoveryVerifierAsync)
            .WithName("PostAccountRecoveryPhrase")
            .WithSummary("Register (or rotate) the recovery-phrase verifier for a professional account")
            .WithDescription("Accepts a client-derived verifier -- never the recovery phrase itself (same contract as the password verifier, ADR-S02-02). Requires an Authorization: Bearer access token for this exact account. Always overwrites any previously registered verifier.")
            .Produces<RegisterRecoveryVerifierResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");
    }

    private static async Task<Results<Ok<RecoverAccessResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleRecoverAsync(
        RecoverAccessRequest request, AccountService accountService, CancellationToken cancellationToken)
    {
        if (!TryValidateRecoverShape(request.Email, request.RecoveryVerifier, out var validationProblem))
        {
            return validationProblem;
        }

        var result = await accountService.RecoverAccessAsync(request.Email, request.RecoveryVerifier, cancellationToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "Invalid recovery phrase", ProblemCodes.AuthInvalidRecoveryPhrase);
        }

        var account = result.Account!;
        return TypedResults.Ok(new RecoverAccessResponse(
            account.Id, account.Email, account.Role, result.TwoFactorRequirement, result.TwoFactorTicket,
            result.Session?.AccessToken, result.Session?.RefreshToken, result.Session?.AccessTokenExpiresAt));
    }

    private static async Task<Results<Ok<RegisterRecoveryVerifierResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleRegisterRecoveryVerifierAsync(
        Guid accountId,
        RegisterRecoveryVerifierRequest request,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        AccountService accountService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        if (request.RecoveryVerifier is not { Length: AccountService.PasswordVerifierLength })
        {
            return ValidationProblem("recoveryVerifier");
        }

        var result = await accountService.RegisterRecoveryVerifierAsync(accountId, request.RecoveryVerifier, cancellationToken);
        if (!result.Succeeded)
        {
            return result.FailureReason switch
            {
                RegisterRecoveryVerifierFailureReason.AccountNotFound =>
                    ProblemJson(StatusCodes.Status404NotFound, "Account not found", ProblemCodes.AuthAccountNotFound),
                _ => ProblemJson(StatusCodes.Status409Conflict, "Account is not a professional account", ProblemCodes.AuthNotAProfessionalAccount),
            };
        }

        return TypedResults.Ok(new RegisterRecoveryVerifierResponse(result.Account!.Id));
    }

    /// <summary>Same shape check as <see cref="AuthEndpoints.TryValidateCredentialsShape"/>, over the recovery verifier instead of the password verifier.</summary>
    private static bool TryValidateRecoverShape(
        string? email, byte[]? recoveryVerifier, out JsonHttpResult<LimmiarProblemDetails> problem)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            problem = ValidationProblem("email");
            return false;
        }

        if (recoveryVerifier is not { Length: AccountService.PasswordVerifierLength })
        {
            problem = ValidationProblem("recoveryVerifier");
            return false;
        }

        problem = default!;
        return true;
    }

    /// <summary>
    /// True only if <paramref name="authorizationHeader"/> is a well-formed
    /// <c>Bearer &lt;token&gt;</c> value whose token <see cref="ISessionTokenIssuer.ValidateAccess"/>
    /// resolves to EXACTLY <paramref name="accountId"/> -- same account-scoping discipline
    /// as <see cref="ProfessionalVerificationEndpoints.HandleSubmitAsync"/>.
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

/// <summary>
/// BIP39 recovery-phrase account recovery (Spec S02, ticket S02-06). Same "no plaintext
/// secret field" contract as <see cref="LoginRequest"/> -- the client derives
/// <see cref="RecoveryVerifier"/> locally and this is the only recovery-phrase-shaped field
/// this contract accepts.
/// </summary>
public sealed record RecoverAccessRequest(string Email, byte[] RecoveryVerifier);

/// <summary>Same field shape/meaning as <see cref="LoginResponse"/> -- a successful recovery re-authenticates the account exactly like a successful login.</summary>
public sealed record RecoverAccessResponse(
    Guid Id,
    string Email,
    AccountRole Role,
    TwoFactorRequirement TwoFactorRequirement,
    string? TwoFactorTicket = null,
    string? AccessToken = null,
    string? RefreshToken = null,
    DateTimeOffset? AccessTokenExpiresAt = null);

/// <summary>Client-derived verifier for the recovery phrase, same contract as <see cref="RecoverAccessRequest.RecoveryVerifier"/>.</summary>
public sealed record RegisterRecoveryVerifierRequest(byte[] RecoveryVerifier);

public sealed record RegisterRecoveryVerifierResponse(Guid AccountId);
