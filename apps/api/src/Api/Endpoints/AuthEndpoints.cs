using Api.Accounts;
using Api.Problems;
using Api.Serialization;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Api.Endpoints;

/// <summary>
/// S02-01 backend: cadastro por e-mail, login por e-mail, e cadastro/login por Google.
/// Owns request validation and HTTP status/Problem+JSON mapping; all actual domain logic
/// (account enumeration mitigation, Google role resolution) lives in
/// <see cref="AccountService"/>, which this class only calls into.
/// </summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/auth/register", HandleRegisterAsync)
            .WithName("PostAuthRegister")
            .WithSummary("Register a new account by e-mail")
            .WithDescription("Accepts a client-derived password verifier -- never a plaintext password (ADR-S02-02).")
            .Produces<RegisterResponse>(StatusCodes.Status201Created)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapPost("/auth/login", HandleLoginAsync)
            .WithName("PostAuthLogin")
            .WithSummary("Log in with e-mail + password verifier")
            .WithDescription("Returns the exact same response (status, code, body) for an unknown e-mail and for a wrong verifier -- account enumeration mitigation.")
            .Produces<LoginResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json");

        app.MapPost("/auth/google", HandleGoogleAsync)
            .WithName("PostAuthGoogle")
            .WithSummary("Register or log in via Google")
            .WithDescription("When the Google identity's e-mail already has an account, its existing role is used and requestedRole is ignored (ADR-S02-01).")
            .Produces<GoogleAuthResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json");
    }

    private static async Task<Results<Created<RegisterResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleRegisterAsync(
        RegisterRequest request, AccountService accountService, CancellationToken cancellationToken)
    {
        if (!TryValidateCredentialsShape(request.Email, request.PasswordVerifier, out var validationProblem))
        {
            return validationProblem;
        }

        var result = await accountService.RegisterAsync(request.Email, request.PasswordVerifier, request.Role, cancellationToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status409Conflict, "Email already registered", ProblemCodes.AuthEmailAlreadyRegistered);
        }

        var account = result.Account!;
        return TypedResults.Created(
            $"/accounts/{account.Id}",
            new RegisterResponse(account.Id, account.Email, account.Role));
    }

    private static async Task<Results<Ok<LoginResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleLoginAsync(
        LoginRequest request, AccountService accountService, CancellationToken cancellationToken)
    {
        if (!TryValidateCredentialsShape(request.Email, request.PasswordVerifier, out var validationProblem))
        {
            return validationProblem;
        }

        var result = await accountService.LoginAsync(request.Email, request.PasswordVerifier, cancellationToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "Invalid credentials", ProblemCodes.AuthInvalidCredentials);
        }

        var account = result.Account!;
        return TypedResults.Ok(new LoginResponse(account.Id, account.Email, account.Role));
    }

    private static async Task<Results<Ok<GoogleAuthResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleGoogleAsync(
        GoogleAuthRequest request, AccountService accountService, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.IdToken))
        {
            return ValidationProblem("idToken");
        }

        var result = await accountService.GoogleAuthAsync(request.IdToken, request.RequestedRole, cancellationToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "Invalid Google token", ProblemCodes.AuthGoogleTokenInvalid);
        }

        var account = result.Account!;
        return TypedResults.Ok(new GoogleAuthResponse(account.Id, account.Email, account.Role, result.IsNewAccount));
    }

    /// <summary>
    /// Shared by register and login: both accept the same (email, passwordVerifier)
    /// shape. A malformed request (missing email, wrong-length verifier) is a validation
    /// error (400) -- a distinct failure category from "wrong credentials" (401), so
    /// rejecting it here, before AccountService is even called, does not touch the
    /// timing-uniformity guarantee LoginAsync provides for well-formed requests.
    /// </summary>
    private static bool TryValidateCredentialsShape(
        string? email, byte[]? passwordVerifier, out JsonHttpResult<LimmiarProblemDetails> problem)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            problem = ValidationProblem("email");
            return false;
        }

        if (passwordVerifier is not { Length: AccountService.PasswordVerifierLength })
        {
            problem = ValidationProblem("passwordVerifier");
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
