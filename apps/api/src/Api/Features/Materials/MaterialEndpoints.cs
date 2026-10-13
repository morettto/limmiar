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

    private static async Task<IResult> AuthorizeAsync(Guid accountId, Guid materialId, MaterialAuthorizationRequest request, IAccountStore accounts, MaterialStore store, CancellationToken ct)
    {
        var denied = await RequireProfessionalAsync(accountId, accounts, ct);
        if (denied is not null) return denied;
        return await store.SetAuthorizationAsync(accountId, materialId, request.Authorized, ct) ? TypedResults.NoContent() : Missing();
    }

    private static async Task<IResult> DeleteAsync(Guid accountId, Guid materialId, IAccountStore accounts, MaterialStore store, CancellationToken ct)
    {
        var denied = await RequireProfessionalAsync(accountId, accounts, ct);
        if (denied is not null) return denied;
        return await store.DeleteAsync(accountId, materialId, ct) ? TypedResults.NoContent() : Missing();
    }

    private static IResult Missing() => ProblemJson(404, "Material not found", MaterialsProblemCodes.MaterialsNotFound);
}
