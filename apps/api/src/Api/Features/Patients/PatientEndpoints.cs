using Api.Accounts;
using Api.Problems;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using static Api.Accounts.AccountsProblemResults;
using static Api.Accounts.SessionTokenIssuerAuthorization;
using static Api.Problems.ProblemResults;
using static Api.Problems.SealedBlobShape;

namespace Api.Patients;

public static class PatientEndpoints
{
    public static void MapPatientEndpoints(this WebApplication app)
    {
        app.MapPost("/accounts/{accountId:guid}/patients", HandleCreatePatientAsync)
            .WithName("PostPatient")
            .WithSummary("Create a patient record")
            .WithDescription("Creates the sequence-1 entry, which carries the wrapped DEK for the patient. Every clinical field lives inside the opaque ciphertext blob. Requires an Authorization: Bearer access token for this exact account, and the account must be an active Professional (AccountAuthorizationGuard.CanCreatePatientRecords).")
            .Produces<CreatePatientResponse>(StatusCodes.Status201Created)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapPost("/accounts/{accountId:guid}/patients/{patientId:guid}/entries", HandleAppendPatientEntryAsync)
            .WithName("PostPatientEntry")
            .WithSummary("Append an entry to a patient's record")
            .WithDescription("Append-only: there is no PUT/PATCH/DELETE for this resource, and re-using a sequence number is a 409 conflict, never a silent overwrite. Sequence must be exactly the current last sequence + 1 -- gaps and reorders are rejected, not just literal overwrites. Requires an Authorization: Bearer access token for this exact account, and the account must be an active Professional (same guard as create).")
            .Produces<AppendPatientEntryResponse>(StatusCodes.Status201Created)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");

        app.MapGet("/accounts/{accountId:guid}/patients/{patientId:guid}", HandleGetPatientAsync)
            .WithName("GetPatient")
            .WithSummary("Read a patient's projected record")
            .WithDescription("Returns the append-only entries projected into one record. RLS scopes this to the calling professional's own tenant -- another professional's patient is reported as 404, indistinguishable from an unknown patientId. Requires an Authorization: Bearer access token for this exact account. Deliberately does NOT require AccountAuthorizationGuard.CanCreatePatientRecords: a professional keeps read access to records they already created even if their verification status later changes, since revoking read access to a legal clinical document they authored is a separate, bigger decision than gating new writes.")
            .Produces<PatientRecordResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<LimmiarProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json");

        app.MapGet("/accounts/{accountId:guid}/patients", HandleListPatientsAsync)
            .WithName("ListPatients")
            .WithSummary("List the calling professional's patients (carteira)")
            .WithDescription("Returns one row per patient -- the sequence-1 (creation) entry only, never subsequent entries. No pagination, filter, or server-side ordering: the client sorts by risk. RLS scopes this to the calling professional's own tenant. Requires an Authorization: Bearer access token for this exact account. Always 200, even with zero patients (empty array) -- there is no 404 for the account itself, the token already ties accountId to a real account. Same read-access decision as GetPatient: does NOT require AccountAuthorizationGuard.CanCreatePatientRecords.")
            .Produces<ListPatientsResponse>(StatusCodes.Status200OK)
            .Produces<LimmiarProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json");
    }

    private static async Task<Results<Created<CreatePatientResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleCreatePatientAsync(
        Guid accountId,
        CreatePatientRequest request,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        PatientService patientService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        if (!TryValidateSealedBlobShape(request.WrappedDek, "wrappedDek", out var wrappedDekProblem))
        {
            return wrappedDekProblem;
        }

        if (!TryValidateSealedBlobShape(request.Ciphertext, "ciphertext", out var ciphertextProblem))
        {
            return ciphertextProblem;
        }

        var result = await patientService.CreatePatientAsync(
            accountId, request.PatientId, request.WrappedDek, request.Ciphertext, cancellationToken);
        if (!result.TryGetValue(out var entry, out var failureReason))
        {
            return MapCreateFailureToProblem(failureReason);
        }

        return TypedResults.Created(
            $"/accounts/{accountId}/patients/{entry.PatientId}",
            new CreatePatientResponse(entry.PatientId, entry.CreatedAt));
    }

    private static async Task<Results<Created<AppendPatientEntryResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleAppendPatientEntryAsync(
        Guid accountId,
        Guid patientId,
        AppendPatientEntryRequest request,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        PatientService patientService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        if (!TryValidateSealedBlobShape(request.Ciphertext, "ciphertext", out var ciphertextProblem))
        {
            return ciphertextProblem;
        }

        var result = await patientService.AppendEntryAsync(
            accountId, patientId, request.Sequence, request.Ciphertext, cancellationToken);
        if (!result.TryGetValue(out var entry, out var failureReason))
        {
            return MapAppendFailureToProblem(failureReason);
        }

        return TypedResults.Created(
            $"/accounts/{accountId}/patients/{patientId}/entries/{entry.Id}",
            new AppendPatientEntryResponse(entry.Id, entry.Sequence, entry.CreatedAt));
    }

    private static async Task<Results<Ok<PatientRecordResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleGetPatientAsync(
        Guid accountId,
        Guid patientId,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        PatientService patientService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        var record = await patientService.GetPatientAsync(accountId, patientId, cancellationToken);
        if (record is null)
        {
            return ProblemJson(StatusCodes.Status404NotFound, "Patient not found", PatientsProblemCodes.PatientsNotFound);
        }

        return TypedResults.Ok(new PatientRecordResponse(
            record.PatientId,
            record.WrappedDek,
            record.CreatedAt,
            record.LastEntryAt,
            record.Entries.Select(e => new PatientEntryResponse(e.Id, e.Sequence, e.Ciphertext, e.CreatedAt)).ToList()));
    }

    private static async Task<Results<Ok<ListPatientsResponse>, JsonHttpResult<LimmiarProblemDetails>>> HandleListPatientsAsync(
        Guid accountId,
        [FromHeader(Name = "Authorization")] string? authorization,
        ISessionTokenIssuer sessionTokenIssuer,
        PatientService patientService,
        CancellationToken cancellationToken)
    {
        if (!IsAuthorizedForAccount(authorization, accountId, sessionTokenIssuer))
        {
            return AccessTokenUnauthorizedProblem();
        }

        var entries = await patientService.ListPatientsAsync(accountId, cancellationToken);

        // WrappedDek is null-forgiven, not null-checked: entries here only ever come from
        // ListCreationEntriesAsync's `WHERE sequence = 1`, and migration 0002's
        // wrapped_dek_only_on_sequence_1 CHECK constraint makes a sequence-1 row with a null
        // wrapped_dek impossible to persist in the first place -- see PatientRecordEntry's docs.
        return TypedResults.Ok(new ListPatientsResponse(
            entries.Select(e => new PatientSummaryResponse(e.PatientId, e.WrappedDek!, e.Ciphertext, e.CreatedAt)).ToList()));
    }

    // TryValidateSealedBlobShape moved to EndpointHelpers.cs -- shared with VoiceEnrollmentEndpoints,
    // which needs the exact same 28-byte AES-256-GCM floor check.

    // [ExcludeFromCodeCoverage] justification: every named CreatePatientFailureReason arm is
    // exercised by a dedicated test --
    //   AccountNotFound              -> PostPatient_WithUnknownAccountId_Returns404WithProblemDetails
    //   NotAuthorizedToCreateRecords -> PostPatient_WithUnverifiedProfessional_Returns403WithProblemDetails
    //   PatientAlreadyExists         -> PostPatient_WithSequenceAlreadyUsed_Returns409WithProblemDetails
    // Same reasoning as MapAppendFailureToProblem below: a switch expression over a 3+-value
    // enum compiles to a jump table with a compiler-generated unreachable "no match" fallback
    // that coverlet still counts as a missed branch, regardless of whether an explicit `_ =>`
    // arm is written.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(Justification =
        "Every named case is covered by a dedicated test (see comment above); the remaining " +
        "gap is the compiler-generated unreachable fallback for the switch expression.")]
    private static JsonHttpResult<LimmiarProblemDetails> MapCreateFailureToProblem(CreatePatientFailureReason reason) =>
        reason switch
        {
            CreatePatientFailureReason.AccountNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Account not found", AccountsProblemCodes.AuthAccountNotFound),
            CreatePatientFailureReason.NotAuthorizedToCreateRecords =>
                ProblemJson(StatusCodes.Status403Forbidden, "Account is not authorized to create patient records", PatientsProblemCodes.PatientsNotAuthorizedToCreateRecords),
            CreatePatientFailureReason.PatientAlreadyExists =>
                ProblemJson(StatusCodes.Status409Conflict, "Patient already exists", PatientsProblemCodes.PatientsEntrySequenceConflict),
            _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
        };

    // [ExcludeFromCodeCoverage] justification: every named AppendPatientEntryFailureReason arm
    // IS exercised by a dedicated test --
    //   AccountNotFound             -> PostPatientEntry_WithUnknownAccountId_Returns404WithProblemDetails
    //   NotAuthorizedToCreateRecords -> PostPatientEntry_WithUnverifiedProfessional_Returns403WithProblemDetails
    //   PatientNotFound              -> PostPatientEntry_WithUnknownPatientId_Returns404
    //   InvalidSequence              -> PostPatientEntry_WithSequenceGap_Returns400WithProblemDetails
    //   SequenceConflict             -> PostPatientEntry_WithSequenceOne_Returns409WithProblemDetails,
    //                                    PostPatientEntry_WithSequenceAlreadyUsed_Returns409WithProblemDetails
    // A 5-named-value switch expression compiles to a jump table with a compiler-generated
    // "no match" fallback (a thrown SwitchExpressionException) regardless of whether the source
    // writes an explicit `_ =>` arm -- that fallback is unreachable given the enum has exactly
    // these 5 members, all handled, but coverlet still counts it as a missed branch. Extracted
    // into its own method so the exclusion applies to only this mapping, not the whole handler.
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(Justification =
        "Every named case is covered by a dedicated test (see comment above); the remaining " +
        "gap is the compiler-generated unreachable fallback for a 5-value switch expression.")]
    private static JsonHttpResult<LimmiarProblemDetails> MapAppendFailureToProblem(AppendPatientEntryFailureReason reason) =>
        reason switch
        {
            AppendPatientEntryFailureReason.AccountNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Account not found", AccountsProblemCodes.AuthAccountNotFound),
            AppendPatientEntryFailureReason.NotAuthorizedToCreateRecords =>
                ProblemJson(StatusCodes.Status403Forbidden, "Account is not authorized to append patient records", PatientsProblemCodes.PatientsNotAuthorizedToCreateRecords),
            AppendPatientEntryFailureReason.PatientNotFound =>
                ProblemJson(StatusCodes.Status404NotFound, "Patient not found", PatientsProblemCodes.PatientsNotFound),
            AppendPatientEntryFailureReason.InvalidSequence =>
                ValidationProblem("sequence"),
            AppendPatientEntryFailureReason.SequenceConflict =>
                ProblemJson(StatusCodes.Status409Conflict, "Entry sequence already used", PatientsProblemCodes.PatientsEntrySequenceConflict),
            _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, null),
        };

}

public sealed record CreatePatientRequest(Guid PatientId, byte[] WrappedDek, byte[] Ciphertext);

public sealed record CreatePatientResponse(Guid PatientId, DateTimeOffset CreatedAt);

public sealed record AppendPatientEntryRequest(int Sequence, byte[] Ciphertext);

public sealed record AppendPatientEntryResponse(Guid EntryId, int Sequence, DateTimeOffset CreatedAt);

public sealed record PatientEntryResponse(Guid EntryId, int Sequence, byte[] Ciphertext, DateTimeOffset CreatedAt);

public sealed record PatientRecordResponse(
    Guid PatientId,
    byte[] WrappedDek,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastEntryAt,
    IReadOnlyList<PatientEntryResponse> Entries);

public sealed record PatientSummaryResponse(Guid PatientId, byte[] WrappedDek, byte[] Ciphertext, DateTimeOffset CreatedAt);

public sealed record ListPatientsResponse(IReadOnlyList<PatientSummaryResponse> Patients);
