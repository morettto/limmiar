using System.Security.Cryptography;
using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using static Api.Problems.ProblemResults;

namespace Api.Accounts;

public sealed record VaultRecoverySlot(Guid Id, byte[] Envelope);
public sealed record VaultRecoverySlotWrite(Guid Id, byte[] Envelope, byte[] Verifier);
public sealed record VaultDocument(Guid Revision, byte[] KeyEnvelope, VaultRecoverySlot[] RecoverySlots);
public sealed record VaultWrite(Guid Revision, byte[] KeyEnvelope, VaultRecoverySlotWrite[] RecoverySlots);
public sealed record RecoverVaultRequest(Guid ExpectedRevision, Guid RecoveryId, byte[] RecoveryVerifier, VaultWrite Document);
public sealed record VaultRecoverySlotStored(Guid Id, byte[] Envelope, byte[] VerifierHash);

public static class ClinicalVaultEndpoints
{
    public static void MapClinicalVault(this IEndpointRouteBuilder app)
    {
        app.MapGet("/accounts/{accountId:guid}/clinical-vault", GetAsync);
        app.MapPost("/accounts/{accountId:guid}/clinical-vault", CreateAsync);
        app.MapPost("/accounts/{accountId:guid}/clinical-vault/recover", RecoverAsync);
    }

    private static bool Valid(VaultWrite? document) => document is { Revision: var revision, KeyEnvelope.Length: 60, RecoverySlots.Length: 3 }
        && revision != Guid.Empty && document.RecoverySlots.All(slot => slot is { Id: var id, Envelope.Length: 60, Verifier.Length: 32 } && id != Guid.Empty)
        && document.RecoverySlots.Select(slot => slot.Id).Distinct().Count() == 3;

    private static async Task<Results<Ok<VaultDocument>, JsonHttpResult<LimmiarProblemDetails>>> GetAsync(
        Guid accountId, ClinicalVaultStore store, HttpContext context, CancellationToken cancellationToken)
    {
        context.Response.Headers.CacheControl = "no-store";
        var vault = await store.GetAsync(accountId, cancellationToken);
        return vault is null ? ProblemJson(404, "Clinical vault not found", AccountsProblemCodes.ClinicalVaultNotFound) : TypedResults.Ok(vault);
    }

    private static async Task<Results<NoContent, JsonHttpResult<LimmiarProblemDetails>>> CreateAsync(
        Guid accountId, VaultWrite request, ClinicalVaultStore store, IAccountStore accounts, CancellationToken cancellationToken)
    {
        if (!Valid(request)) return ValidationProblem("document");
        var account = await accounts.FindByIdAsync(accountId, cancellationToken);
        if (account?.Role != AccountRole.Professional) return ProblemJson(403, "Professional account required", AccountsProblemCodes.AuthForbidden);
        return await store.CreateAsync(accountId, request, cancellationToken)
            ? TypedResults.NoContent() : ProblemJson(409, "Clinical vault already exists", AccountsProblemCodes.ClinicalVaultConflict);
    }

    private static async Task<Results<NoContent, JsonHttpResult<LimmiarProblemDetails>>> RecoverAsync(
        Guid accountId, RecoverVaultRequest request, ClinicalVaultStore store, CancellationToken cancellationToken)
    {
        if (!Valid(request.Document) || request.ExpectedRevision == Guid.Empty || request.RecoveryId == Guid.Empty ||
            request.RecoveryVerifier is not { Length: 32 } || request.Document.Revision == request.ExpectedRevision)
            return ValidationProblem("document");
        return await store.RecoverAsync(accountId, request, cancellationToken)
            ? TypedResults.NoContent() : ProblemJson(409, "Recovery code invalid or vault changed", AccountsProblemCodes.ClinicalVaultRecoveryFailed);
    }

    internal static VaultRecoverySlotStored[] Stored(VaultWrite document) => document.RecoverySlots.Select(slot =>
        new VaultRecoverySlotStored(slot.Id, slot.Envelope, SHA256.HashData(slot.Verifier))).ToArray();
}
