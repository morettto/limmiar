using Api.Accounts;
using Api.Problems;
using Microsoft.AspNetCore.Mvc;
using static Api.Problems.ProblemResults;

namespace Api.Materials;

public static class MaterialEndpoints
{
    public static void MapMaterialEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/accounts/{accountId:guid}/materials");
        group.MapPost("", CreateAsync).WithMetadata(new RequestSizeLimitAttribute(29_000_000));
        group.MapGet("", ListAsync);
        group.MapPut("/usage/{sessionId:guid}", SetUsageAsync);
        group.MapPut("/usage/{sessionId:guid}/captures/{captureId:guid}", BeginCaptureAsync);
        group.MapDelete("/usage/{sessionId:guid}/captures/{captureId:guid}", ReleaseCaptureAsync);
        group.MapGet("/{materialId:guid}/content", GetContentAsync);
        group.MapPut("/{materialId:guid}/authorization", AuthorizeAsync);
        group.MapDelete("/{materialId:guid}", DeleteAsync);
    }

    private static async Task<IResult?> RequireProfessionalAsync(Guid id, IAccountStore accounts, CancellationToken ct)
    {
        var account = await accounts.FindByIdAsync(id, ct);
        if (account is null) return ProblemJson(404, "Account not found", AccountsProblemCodes.AuthAccountNotFound);
        if (!AccountAuthorizationGuard.CanCreatePatientRecords(account))
            return ProblemJson(403, "Active professional required", Patients.PatientsProblemCodes.PatientsNotAuthorizedToCreateRecords);
        return null;
    }

    private static async Task<IResult> CreateAsync(Guid accountId, CreateMaterialRequest request, IAccountStore accounts, MaterialStore store, CancellationToken ct)
    {
        var denied = await RequireProfessionalAsync(accountId, accounts, ct);
        if (denied is not null) return denied;
        if (request.MaterialId == Guid.Empty) return ValidationProblem("materialId");
        if (request.WrappedDek is null || request.WrappedDek.Length != 60) return ValidationProblem("wrappedDek");
        if (request.MetadataCiphertext is null || request.MetadataCiphertext.Length < 28 || request.MetadataCiphertext.Length > 16384)
            return ValidationProblem("metadataCiphertext");
        if (request.ContentCiphertext is null || request.ContentCiphertext.Length < 29 || request.ContentCiphertext.Length > 20971548)
            return ValidationProblem("contentCiphertext");
        if (!await store.CreateAsync(accountId, request, ct)) return ProblemJson(409, "Material already exists", MaterialsProblemCodes.MaterialsAlreadyExists);
        return TypedResults.Created($"/accounts/{accountId}/materials/{request.MaterialId}");
    }

    private static async Task<IResult> ListAsync(Guid accountId, IAccountStore accounts, MaterialStore store, CancellationToken ct)
    {
        var denied = await RequireProfessionalAsync(accountId, accounts, ct);
        return denied ?? TypedResults.Ok(await store.ListAsync(accountId, ct));
    }

    private static async Task<IResult> GetContentAsync(Guid accountId, Guid materialId, IAccountStore accounts, MaterialStore store, CancellationToken ct)
    {
        var denied = await RequireProfessionalAsync(accountId, accounts, ct);
        if (denied is not null) return denied;
        var content = await store.GetContentAsync(accountId, materialId, ct);
        return content is null ? Missing() : TypedResults.Ok(content);
    }

    private static async Task<IResult> AuthorizeAsync(Guid accountId, Guid materialId, MaterialAuthorizationRequest request, HttpContext context, IAccountStore accounts, MaterialStore store, MaterialReadiness readiness, CancellationToken ct)
    {
        var denied = await RequireProfessionalAsync(accountId, accounts, ct);
        if (denied is not null) return denied;
        if (request.Authorized)
        {
            if (!await store.ContainsAsync(accountId, [materialId], ct)) return Missing();
            var unavailable = ReadinessFailure(await readiness.CheckAsync(accountId, [materialId], context.Request.Headers.Authorization.ToString(), ct));
            if (unavailable is not null) return unavailable;
        }
        return await store.SetAuthorizationAsync(accountId, materialId, request.Authorized, ct) ? TypedResults.NoContent() : Missing();
    }

    private static async Task<IResult> DeleteAsync(Guid accountId, Guid materialId, IAccountStore accounts, MaterialStore store, CancellationToken ct)
    {
        var denied = await RequireProfessionalAsync(accountId, accounts, ct);
        if (denied is not null) return denied;
        return await store.DeleteAsync(accountId, materialId, ct) switch
        {
            MaterialMutation.Success => TypedResults.NoContent(),
            MaterialMutation.InUse => ProblemJson(409, "Material is in use", MaterialsProblemCodes.MaterialsInUse),
            _ => Missing()
        };
    }

    private static Task<IResult> SetUsageAsync(Guid accountId, Guid sessionId, MaterialUsageRequest request, HttpContext context, IAccountStore accounts, MaterialStore store, MaterialReadiness readiness, CancellationToken ct) =>
        UpdateUsageAsync(accountId, sessionId, request, context, accounts, store, readiness, ct, null);

    private static Task<IResult> BeginCaptureAsync(Guid accountId, Guid sessionId, Guid captureId, MaterialUsageRequest request, HttpContext context, IAccountStore accounts, MaterialStore store, MaterialReadiness readiness, CancellationToken ct) =>
        captureId == Guid.Empty ? Task.FromResult<IResult>(ValidationProblem("captureId"))
            : UpdateUsageAsync(accountId, sessionId, request, context, accounts, store, readiness, ct, captureId);

    private static async Task<IResult> ReleaseCaptureAsync(Guid accountId, Guid sessionId, Guid captureId, IAccountStore accounts, MaterialStore store, CancellationToken ct)
    {
        var denied = await RequireProfessionalAsync(accountId, accounts, ct);
        if (denied is not null) return denied;
        if (sessionId == Guid.Empty || captureId == Guid.Empty) return ValidationProblem("captureId");
        await store.ReleaseCaptureAsync(accountId, sessionId, captureId, ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> UpdateUsageAsync(Guid accountId, Guid sessionId, MaterialUsageRequest request, HttpContext context, IAccountStore accounts, MaterialStore store, MaterialReadiness readiness, CancellationToken ct, Guid? captureId)
    {
        var denied = await RequireProfessionalAsync(accountId, accounts, ct);
        if (denied is not null) return denied;
        if (sessionId == Guid.Empty) return ValidationProblem("sessionId");
        if (request.MaterialIds is null || request.MaterialIds.Length > 1000 || request.MaterialIds.Any(id => id == Guid.Empty)
            || request.MaterialIds.Distinct().Count() != request.MaterialIds.Length) return ValidationProblem("materialIds");
        if (request.MaterialIds.Length > 0)
        {
            if (!await store.ContainsAsync(accountId, request.MaterialIds, ct)) return Missing();
            var unavailable = ReadinessFailure(await readiness.CheckAsync(accountId, request.MaterialIds, context.Request.Headers.Authorization.ToString(), ct));
            if (unavailable is not null) return unavailable;
        }
        return await store.SetUsageAsync(accountId, sessionId, request.MaterialIds, ct, captureId) switch
        {
            MaterialMutation.Success => TypedResults.NoContent(),
            MaterialMutation.InUse => ProblemJson(409, "Session has an active capture", MaterialsProblemCodes.MaterialsInUse),
            MaterialMutation.SessionClosed => ProblemJson(409, "Session is closed", MaterialsProblemCodes.MaterialsSessionClosed),
            MaterialMutation.NotAuthorized => ProblemJson(409, "Material is not authorized", MaterialsProblemCodes.MaterialsNotAuthorized),
            _ => Missing()
        };
    }

    private static IResult? ReadinessFailure(MaterialReadinessResult result) => result switch
    {
        MaterialReadinessResult.NotPrepared => ProblemJson(409, "Material is not prepared", MaterialsProblemCodes.MaterialsNotPrepared),
        MaterialReadinessResult.Unavailable => ProblemJson(503, "Material readiness unavailable", MaterialsProblemCodes.MaterialsReadinessUnavailable),
        _ => null
    };

    private static IResult Missing() => ProblemJson(404, "Material not found", MaterialsProblemCodes.MaterialsNotFound);
}
