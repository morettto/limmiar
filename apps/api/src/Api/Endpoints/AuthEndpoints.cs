using Api.Accounts;
using Api.Problems;
using Api.Serialization;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Api.Endpoints;

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

        app.MapPost("/auth/magic-link/request", HandleMagicLinkRequestAsync)
            .WithName("PostAuthMagicLinkRequest")
            .WithSummary("Request a magic-link sign-in for a patient e-mail")
            .WithDescription("Always returns the same response regardless of whether the e-mail matches an existing Patient account, an existing Professional account, or nothing at all -- account enumeration mitigation (S02-05).")
            .Produces<MagicLinkRequestResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json");

        app.MapPost("/auth/magic-link/verify", HandleVerifyMagicLinkAsync)
            .WithName("PostAuthMagicLinkVerify")
            .WithSummary("Burn a magic-link token and start the WebAuthn ceremony")
            .WithDescription("Resolves whether the e-mail needs a new WebAuthn credential (registration) or already has one (assertion), and returns a fresh challenge plus a short-lived magicLinkTicket to complete it with.")
            .Produces<VerifyMagicLinkResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json");

        app.MapPost("/auth/magic-link/webauthn/complete", HandleCompleteMagicLinkWebAuthnAsync)
            .WithName("PostAuthMagicLinkWebAuthnComplete")
            .WithSummary("Complete the WebAuthn ceremony a magic-link verify started")
            .WithDescription("Accepts either a registration or an assertion response shape -- which one applies is decided by magicLinkTicket, not by the caller.")
            .Produces<CompleteMagicLinkWebAuthnResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json");
    }

    // Only mapped by Program.Composition.cs when MagicLink:TestCaptureEndpoint=true.
    public static void MapMagicLinkDebugEndpoints(this WebApplication app)
    {
        app.MapGet("/auth/magic-link/_debug-last", HandleMagicLinkDebugLastAsync)
            .WithName("GetAuthMagicLinkDebugLast")
            .WithSummary("E2E-only: read back the token the last magic-link request captured for this e-mail")
            .WithDescription("Never mapped unless MagicLink:TestCaptureEndpoint=true -- there is no real e-mail delivery to intercept otherwise (see CapturingMagicLinkEmailSender's own doc comment).")
            .Produces<MagicLinkDebugLastResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound);
    }

    private static Results<Ok<MagicLinkDebugLastResponse>, NotFound> HandleMagicLinkDebugLastAsync(
        string? email, CapturingMagicLinkEmailSender sender)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return TypedResults.NotFound();
        }

        var token = sender.LastTokenSentTo(email);
        return token is null ? TypedResults.NotFound() : TypedResults.Ok(new MagicLinkDebugLastResponse(token));
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
            new RegisterResponse(
                account.Id, account.Email, account.Role, result.TwoFactorRequirement, result.TwoFactorTicket,
                result.Session?.AccessToken, result.Session?.RefreshToken, result.Session?.AccessTokenExpiresAt));
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
        return TypedResults.Ok(new LoginResponse(
            account.Id, account.Email, account.Role, result.TwoFactorRequirement, result.TwoFactorTicket,
            result.Session?.AccessToken, result.Session?.RefreshToken, result.Session?.AccessTokenExpiresAt));
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
        return TypedResults.Ok(new GoogleAuthResponse(
            account.Id, account.Email, account.Role, result.IsNewAccount, result.TwoFactorRequirement, result.TwoFactorTicket,
            result.Session?.AccessToken, result.Session?.RefreshToken, result.Session?.AccessTokenExpiresAt));
    }

    private static async Task<Results<Ok<RefreshTokenResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleRefreshAsync(
        RefreshTokenRequest request, AccountService accountService, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken))
        {
            return ValidationProblem("refreshToken");
        }

        var result = await accountService.RefreshSessionAsync(request.RefreshToken, cancellationToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "Invalid refresh token", ProblemCodes.AuthRefreshTokenInvalid);
        }

        var session = result.TokenPair!;
        return TypedResults.Ok(new RefreshTokenResponse(session.AccessToken, session.RefreshToken, session.AccessTokenExpiresAt));
    }

    private static async Task<Results<Ok<MagicLinkRequestResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleMagicLinkRequestAsync(
        MagicLinkRequestRequest request, AccountService accountService, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Email))
        {
            return ValidationProblem("email");
        }

        await accountService.RequestMagicLinkAsync(request.Email, cancellationToken);
        return TypedResults.Ok(new MagicLinkRequestResponse());
    }

    private static async Task<Results<Ok<VerifyMagicLinkResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleVerifyMagicLinkAsync(
        VerifyMagicLinkRequest request, AccountService accountService, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Token))
        {
            return ValidationProblem("token");
        }

        var result = await accountService.VerifyMagicLinkAsync(request.Token, cancellationToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "Invalid magic link", ProblemCodes.AuthMagicLinkInvalid);
        }

        return TypedResults.Ok(new VerifyMagicLinkResponse(
            result.MagicLinkTicket!,
            result.CeremonyType!.Value,
            Convert.ToBase64String(result.Challenge!),
            accountService.WebAuthnRelyingPartyId,
            result.CredentialId is null ? null : Convert.ToBase64String(result.CredentialId)));
    }

    private static async Task<Results<Ok<CompleteMagicLinkWebAuthnResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleCompleteMagicLinkWebAuthnAsync(
        CompleteMagicLinkWebAuthnRequest request, AccountService accountService, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.MagicLinkTicket))
        {
            return ValidationProblem("magicLinkTicket");
        }

        if (!TryDecodeBase64(request.CredentialId, out var credentialId))
        {
            return ValidationProblem("credentialId");
        }

        if (!TryDecodeBase64(request.ClientDataJson, out var clientDataJson))
        {
            return ValidationProblem("clientDataJson");
        }

        if (!TryDecodeBase64Optional(request.AttestationObject, out var attestationObject))
        {
            return ValidationProblem("attestationObject");
        }

        if (!TryDecodeBase64Optional(request.AuthenticatorData, out var authenticatorData))
        {
            return ValidationProblem("authenticatorData");
        }

        if (!TryDecodeBase64Optional(request.Signature, out var signature))
        {
            return ValidationProblem("signature");
        }

        var result = await accountService.CompleteMagicLinkWebAuthnAsync(
            request.MagicLinkTicket, credentialId!, clientDataJson!, attestationObject, authenticatorData, signature, cancellationToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "WebAuthn ceremony failed", ProblemCodes.AuthWebAuthnCeremonyFailed);
        }

        var account = result.Account!;
        var session = result.Session!;
        return TypedResults.Ok(new CompleteMagicLinkWebAuthnResponse(
            account.Id, account.Email, account.Role, session.AccessToken, session.RefreshToken, session.AccessTokenExpiresAt));
    }

    private static bool TryDecodeBase64(string? value, out byte[]? bytes)
    {
        if (string.IsNullOrEmpty(value))
        {
            bytes = null;
            return false;
        }

        try
        {
            bytes = Convert.FromBase64String(value);
            return true;
        }
        catch (FormatException)
        {
            bytes = null;
            return false;
        }
    }

    private static bool TryDecodeBase64Optional(string? value, out byte[]? bytes)
    {
        if (value is null)
        {
            bytes = null;
            return true;
        }

        return TryDecodeBase64(value, out bytes);
    }

    // Rejecting a malformed shape here (before AccountService) doesn't touch LoginAsync's timing-uniformity guarantee -- 400 and 401 stay distinct failure categories.
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

public sealed record RefreshTokenRequest(string RefreshToken);

public sealed record RefreshTokenResponse(string AccessToken, string RefreshToken, DateTimeOffset AccessTokenExpiresAt);

public sealed record MagicLinkRequestRequest(string Email);

public sealed record MagicLinkRequestResponse;

public sealed record VerifyMagicLinkRequest(string Token);

// CredentialId is set only for an assertion ceremony (CeremonyType); Challenge is raw base64 bytes for navigator.credentials.create()/.get().
public sealed record VerifyMagicLinkResponse(
    string MagicLinkTicket,
    MagicLinkCeremonyType CeremonyType,
    string Challenge,
    string RelyingPartyId,
    string? CredentialId);

// AttestationObject is set for a registration response; AuthenticatorData/Signature for an assertion response -- which pair applies is decided server-side by MagicLinkTicket.
public sealed record CompleteMagicLinkWebAuthnRequest(
    string MagicLinkTicket,
    string CredentialId,
    string ClientDataJson,
    string? AttestationObject,
    string? AuthenticatorData,
    string? Signature);

public sealed record CompleteMagicLinkWebAuthnResponse(
    Guid Id, string Email, AccountRole Role, string AccessToken, string RefreshToken, DateTimeOffset AccessTokenExpiresAt);

public sealed record MagicLinkDebugLastResponse(string Token);
