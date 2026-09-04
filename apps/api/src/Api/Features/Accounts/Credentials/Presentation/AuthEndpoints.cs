using Api.Problems;
using Api.Serialization;
using Mediator;
using Microsoft.AspNetCore.Http.HttpResults;
using static Api.Accounts.AccountsProblemResults;
using static Api.Problems.ProblemResults;

namespace Api.Accounts;

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

        app.MapPost("/auth/refresh", HandleRefreshAsync)
            .WithName("PostAuthRefresh")
            .WithSummary("Rotate a refresh token into a fresh access/refresh pair")
            .WithDescription("Burns the presented refresh token. Returns the exact same response (status, code, body) whether the token was never issued, expired, or already used -- reuse of an already-used token additionally revokes its entire session family (S02-08).")
            .Produces<RefreshTokenResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json");
    }

    private static async Task<Results<Created<RegisterResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleRegisterAsync(
        RegisterRequest request, ISender sender, CancellationToken cancellationToken)
    {
        if (!TryValidateCredentialsShape(request.Email, request.PasswordVerifier, out var validationProblem))
        {
            return validationProblem;
        }

        var result = await sender.Send(new RegisterCommand(request.Email, request.PasswordVerifier, request.Role), cancellationToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status409Conflict, "Email already registered", AccountsProblemCodes.AuthEmailAlreadyRegistered);
        }

        var account = result.Account!;
        return TypedResults.Created(
            $"/accounts/{account.Id}",
            new RegisterResponse(
                account.Id, account.Email, account.Role, result.TwoFactorRequirement, result.TwoFactorTicket,
                result.Session?.AccessToken, result.Session?.RefreshToken, result.Session?.AccessTokenExpiresAt));
    }

    private static async Task<Results<Ok<LoginResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleLoginAsync(
        LoginRequest request, ISender sender, CancellationToken cancellationToken)
    {
        if (!TryValidateCredentialsShape(request.Email, request.PasswordVerifier, out var validationProblem))
        {
            return validationProblem;
        }

        var result = await sender.Send(new LoginCommand(request.Email, request.PasswordVerifier), cancellationToken);
        if (!result.TryGetValue(out var success, out _))
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "Invalid credentials", AccountsProblemCodes.AuthInvalidCredentials);
        }

        var account = success.Account;
        return TypedResults.Ok(new LoginResponse(
            account.Id, account.Email, account.Role, success.TwoFactorRequirement, success.TwoFactorTicket,
            success.Session?.AccessToken, success.Session?.RefreshToken, success.Session?.AccessTokenExpiresAt));
    }

    private static async Task<Results<Ok<GoogleAuthResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleGoogleAsync(
        GoogleAuthRequest request, ISender sender, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.IdToken))
        {
            return ValidationProblem("idToken");
        }

        var result = await sender.Send(new ContinueWithGoogleCommand(request.IdToken, request.RequestedRole), cancellationToken);
        if (!result.TryGetValue(out var success, out _))
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "Invalid Google token", AccountsProblemCodes.AuthGoogleTokenInvalid);
        }

        var account = success.Account;
        return TypedResults.Ok(new GoogleAuthResponse(
            account.Id, account.Email, account.Role, success.IsNewAccount, success.TwoFactorRequirement, success.TwoFactorTicket,
            success.Session?.AccessToken, success.Session?.RefreshToken, success.Session?.AccessTokenExpiresAt));
    }

    private static Results<Ok<RefreshTokenResponse>, JsonHttpResult<LimmiarProblemDetails>> HandleRefreshAsync(
        RefreshTokenRequest request, ISessionTokenIssuer sessionTokenIssuer)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken))
        {
            return ValidationProblem("refreshToken");
        }

        var result = sessionTokenIssuer.Refresh(request.RefreshToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "Invalid refresh token", AccountsProblemCodes.AuthRefreshTokenInvalid);
        }

        var session = result.TokenPair!;
        return TypedResults.Ok(new RefreshTokenResponse(session.AccessToken, session.RefreshToken, session.AccessTokenExpiresAt));
    }

    private static bool TryValidateCredentialsShape(
        string? email, byte[]? passwordVerifier, out JsonHttpResult<LimmiarProblemDetails> problem)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            problem = ValidationProblem("email");
            return false;
        }

        if (passwordVerifier is not { Length: AccountVerifierLengths.PasswordVerifierLength })
        {
            problem = ValidationProblem("passwordVerifier");
            return false;
        }

        problem = default!;
        return true;
    }

}

public sealed record RefreshTokenRequest(string RefreshToken);

public sealed record RefreshTokenResponse(string AccessToken, string RefreshToken, DateTimeOffset AccessTokenExpiresAt);
