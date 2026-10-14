using Api.Problems;
using Api.Serialization;
using Mediator;
using Microsoft.AspNetCore.Http.HttpResults;
using static Api.Accounts.AccountsProblemResults;
using static Api.Problems.ProblemResults;

namespace Api.Accounts;

public static class MagicLinkEndpoints
{
    public static void MapMagicLinkEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/auth/magic-link/verify", HandleVerifyMagicLinkAsync)
            .WithName("PostAuthMagicLinkVerify")
            .WithSummary("Start a passkey ceremony for an anonymous patient invitation")
            .WithDescription("Resolves an opaque, professional-issued invitation and its existing patient passkey, and returns a fresh challenge plus a short-lived magicLinkTicket to complete it with.")
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

    private static async Task<Results<Ok<VerifyMagicLinkResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleVerifyMagicLinkAsync(
        VerifyMagicLinkRequest request, ISender sender, WebAuthnRelyingPartyOptions relyingPartyOptions, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Token))
        {
            return ValidationProblem("token");
        }

        var result = await sender.Send(new VerifyMagicLinkCommand(request.Token, request.PatientAccountId), cancellationToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "Invalid magic link", AccountsProblemCodes.AuthMagicLinkInvalid);
        }

        return TypedResults.Ok(new VerifyMagicLinkResponse(
            result.MagicLinkTicket!,
            result.CeremonyType!.Value,
            Convert.ToBase64String(result.Challenge!),
            relyingPartyOptions.RelyingPartyId,
            result.CredentialId is null ? null : Convert.ToBase64String(result.CredentialId), result.AccountId!.Value));
    }

    private static async Task<Results<Ok<CompleteMagicLinkWebAuthnResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleCompleteMagicLinkWebAuthnAsync(
        CompleteMagicLinkWebAuthnRequest request, ISender sender, CancellationToken cancellationToken)
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

        var result = await sender.Send(
            new CompleteMagicLinkWebAuthnCommand(
                request.MagicLinkTicket, credentialId!, clientDataJson!, attestationObject, authenticatorData, signature),
            cancellationToken);
        if (!result.Succeeded)
        {
            return ProblemJson(StatusCodes.Status401Unauthorized, "WebAuthn ceremony failed", AccountsProblemCodes.AuthWebAuthnCeremonyFailed);
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
}

public sealed record VerifyMagicLinkRequest(string Token, Guid? PatientAccountId = null);

// CredentialId is set only for an assertion ceremony (CeremonyType); Challenge is raw base64 bytes for navigator.credentials.create()/.get().
public sealed record VerifyMagicLinkResponse(
    string MagicLinkTicket,
    MagicLinkCeremonyType CeremonyType,
    string Challenge,
    string RelyingPartyId,
    string? CredentialId,
    Guid AccountId);

// AttestationObject is set for a registration response; AuthenticatorData/Signature for an assertion response -- which pair applies is decided server-side by MagicLinkTicket.
public sealed record CompleteMagicLinkWebAuthnRequest(
    string MagicLinkTicket,
    string CredentialId,
    string ClientDataJson,
    string? AttestationObject,
    string? AuthenticatorData,
    string? Signature);

public sealed record CompleteMagicLinkWebAuthnResponse(
    Guid Id, string? Email, AccountRole Role, string AccessToken, string RefreshToken, DateTimeOffset AccessTokenExpiresAt);

