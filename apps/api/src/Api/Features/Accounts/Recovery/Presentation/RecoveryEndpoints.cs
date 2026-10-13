using Api.Problems;
using Api.Serialization;
using Mediator;
using Microsoft.AspNetCore.Http.HttpResults;
using static Api.Problems.ProblemResults;

namespace Api.Accounts;

public static class RecoveryEndpoints
{
    public static void MapRecoveryEndpoints(this IEndpointRouteBuilder app)
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
            .WithSummary("Register or rotate recovery credentials and an encrypted clinical-key envelope")
            .WithDescription("Accepts a client-derived verifier and an opaque encrypted key envelope, never the phrase or plaintext clinical key. Requires an Authorization: Bearer access token for this exact professional account. Replaces both recovery fields together.")
            .Produces<RegisterRecoveryVerifierResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");
    }

    private static async Task<Results<Ok<RecoverAccessResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleRecoverAsync(
        RecoverAccessRequest request, ISender sender, CancellationToken cancellationToken)
    {
        if (!TryValidateRecoverShape(request.Email, request.RecoveryVerifier, out var validationProblem))
        {
            return validationProblem;
        }

        var result = await sender.Send(new RecoverAccessCommand(request.Email, request.RecoveryVerifier), cancellationToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "Invalid recovery phrase", AccountsProblemCodes.AuthInvalidRecoveryPhrase);
        }

        var account = result.Account!;
        return TypedResults.Ok(new RecoverAccessResponse(
            account.Id, account.Email, account.Role, result.TwoFactorRequirement, result.TwoFactorTicket,
            result.Session?.AccessToken, result.Session?.RefreshToken, result.Session?.AccessTokenExpiresAt,
            account.RecoveryEnvelope!));
    }

    private static async Task<Results<Ok<RegisterRecoveryVerifierResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleRegisterRecoveryVerifierAsync(
        Guid accountId,
        RegisterRecoveryVerifierRequest request,
        ISender sender,
        CancellationToken cancellationToken)
    {
        if (request.RecoveryVerifier is not { Length: AccountVerifierLengths.PasswordVerifierLength })
        {
            return ValidationProblem("recoveryVerifier");
        }

        if (request.RecoveryEnvelope is not { Length: 120 })
        {
            return ValidationProblem("recoveryEnvelope");
        }

        var result = await sender.Send(new RegisterRecoveryVerifierCommand(accountId, request.RecoveryVerifier, request.RecoveryEnvelope), cancellationToken);
        if (!result.Succeeded)
        {
            return result.FailureReason switch
            {
                RegisterRecoveryVerifierFailureReason.AccountNotFound =>
                    ProblemJson(StatusCodes.Status404NotFound, "Account not found", AccountsProblemCodes.AuthAccountNotFound),
                _ => ProblemJson(StatusCodes.Status409Conflict, "Account is not a professional account", AccountsProblemCodes.AuthNotAProfessionalAccount),
            };
        }

        return TypedResults.Ok(new RegisterRecoveryVerifierResponse(result.Account!.Id));
    }

    private static bool TryValidateRecoverShape(
        string? email, byte[]? recoveryVerifier, out JsonHttpResult<LimmiarProblemDetails> problem)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            problem = ValidationProblem("email");
            return false;
        }

        if (recoveryVerifier is not { Length: AccountVerifierLengths.PasswordVerifierLength })
        {
            problem = ValidationProblem("recoveryVerifier");
            return false;
        }

        problem = default!;
        return true;
    }

}

public sealed record RecoverAccessRequest(string Email, byte[] RecoveryVerifier);

public sealed record RecoverAccessResponse(
    Guid Id,
    string? Email,
    AccountRole Role,
    TwoFactorRequirement TwoFactorRequirement,
    string? TwoFactorTicket,
    string? AccessToken,
    string? RefreshToken,
    DateTimeOffset? AccessTokenExpiresAt,
    byte[] RecoveryEnvelope);

public sealed record RegisterRecoveryVerifierRequest(byte[] RecoveryVerifier, byte[] RecoveryEnvelope);

public sealed record RegisterRecoveryVerifierResponse(Guid AccountId);
